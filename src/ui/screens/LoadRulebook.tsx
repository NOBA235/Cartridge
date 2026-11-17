/**
 * Load a rulebook: pick a PDF, .txt or .md file, or paste text. The text is
 * read on this device, checked, and saved locally. Nothing is sent until the
 * user presses 'Make the cartridge' on a saved rulebook (cloud, once).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { draftFromFile, draftFromPaste } from '@/cartridge/loadSource';
import { confirmSource, SourceError, type SourceDoc, type SourceDraft } from '@/cartridge/source';
import { sourcesStore } from '@/cartridge/store';
import { verifyQuote, type VerifyResult } from '@/cartridge/verifyQuote';
import { CartridgeList } from '@/ui/components/CartridgeList';
import { CompilePanel } from '@/ui/components/CompilePanel';
import { SourceContext } from '@/ui/components/SourceContext';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/primitives/card';
import { inputClass, textareaClass } from '@/ui/styles';
import { requestPersistentStorage, storageErrorMessage } from '@/lib/storageErrors';

function describeError(e: unknown): string {
  if (e instanceof SourceError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function SourceFacts({ s }: { s: SourceDraft }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Name</dt>
      <dd className="break-all">{s.name}</dd>
      <dt className="text-muted-foreground">Type</dt>
      <dd>{s.kind === 'pdf' ? 'PDF' : s.kind === 'markdown' ? 'Markdown' : 'Text'}</dd>
      {s.pageCount !== undefined && (
        <>
          <dt className="text-muted-foreground">Pages</dt>
          <dd>{s.pageCount}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Characters</dt>
      <dd>{s.charCount.toLocaleString()}</dd>
      <dt className="text-muted-foreground">Fingerprint</dt>
      <dd>
        <code className="text-xs" title={`SHA-256 ${s.hash}`}>
          {s.hash.slice(0, 16)}
        </code>
      </dd>
    </dl>
  );
}

function QuoteCheck({ source }: { source: SourceDoc }) {
  const id = useId();
  const [quote, setQuote] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);

  const check = (e: FormEvent) => {
    e.preventDefault();
    setResult(verifyQuote(quote, source));
  };

  return (
    <form onSubmit={check} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Check a passage against &lsquo;{source.name}&rsquo;
      </label>
      <textarea
        id={id}
        className={`${textareaClass} min-h-20`}
        value={quote}
        onChange={(e) => {
          setQuote(e.target.value);
          setResult(null);
        }}
        placeholder="Paste a sentence from the document"
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={!quote.trim()}
      >
        Check
      </Button>
      <div aria-live="polite">
        {result?.ok && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-success">
              Verified against the source{result.page !== undefined && `, page ${result.page}`}
              {result.occurrences > 1 && ` (appears ${result.occurrences} times)`}
            </p>
            <SourceContext text={source.text} start={result.start} end={result.end} />
          </div>
        )}
        {result && !result.ok && (
          <p className="text-sm text-destructive">
            {result.reason === 'EMPTY_QUOTE'
              ? 'There is nothing to check.'
              : 'Not found in the source.'}
          </p>
        )}
      </div>
    </form>
  );
}

function SavedSource({
  s,
  selected,
  onSelect,
  onDelete,
}: {
  s: SourceDoc;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium break-all">{s.name}</p>
          <p className="text-xs text-muted-foreground">
            {s.pageCount !== undefined ? `${s.pageCount} pages, ` : ''}
            {s.charCount.toLocaleString()} characters. Licence: {s.licence}. Loaded{' '}
            {new Date(s.createdAt).toLocaleString()}.
          </p>
          {s.warnings.map((w) => (
            <p key={w.code} className="mt-1 text-xs text-warning">
              {w.message}
            </p>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onSelect} aria-pressed={selected}>
            {selected ? 'Hide passage check' : 'Check a passage'}
          </Button>
          {confirming ? (
            <>
              <Button variant="destructive" size="sm" onClick={onDelete}>
                Delete from this device
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {selected && <QuoteCheck source={s} />}
      <CompilePanel source={s} />
    </li>
  );
}

export function LoadRulebook() {
  const fileId = useId();
  const pasteNameId = useId();
  const pasteId = useId();
  const licenceId = useId();
  const confirmId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [licence, setLicence] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [saved, setSaved] = useState<SourceDoc[] | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const applyList = useCallback(
    (list: Promise<SourceDoc[]>, isLive: () => boolean = () => true) => {
      return list.then(
        (l) => {
          if (!isLive()) return;
          setSaved(l);
          setStorageError(null);
        },
        (e: unknown) => {
          if (!isLive()) return;
          setSaved([]);
          setStorageError(`Saved rulebooks are not available: ${describeError(e)}`);
        },
      );
    },
    [],
  );

  const refresh = useCallback(() => applyList(sourcesStore.list()), [applyList]);

  useEffect(() => {
    let live = true;
    void applyList(sourcesStore.list(), () => live);
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [applyList]);

  const resetDraft = () => {
    setDraft(null);
    setLicence('');
    setConfirmed(false);
    setError(null);
  };

  const readFile = async (file: File) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    resetDraft();
    setBusy(`Reading ${file.name}…`);
    try {
      const d = await draftFromFile(
        file,
        (p) => setBusy(`Reading page ${p.page} of ${p.pageCount}…`),
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) setDraft(d);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(describeError(e));
    } finally {
      if (!ctrl.signal.aborted) setBusy(null);
    }
  };

  const readPaste = async (e: FormEvent) => {
    e.preventDefault();
    resetDraft();
    try {
      setDraft(await draftFromPaste(pasteName, pasteText));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    try {
      const doc = confirmSource(draft, licence);
      try {
        await sourcesStore.put(doc);
      } catch (err) {
        setError(storageErrorMessage(err, 'the rulebook'));
        return;
      }
      // Rulebooks are what make the app work offline: ask the browser to keep them.
      void requestPersistentStorage();
      resetDraft();
      setPasteText('');
      setPasteName('');
      if (fileInput.current) fileInput.current.value = '';
      setSelectedId(doc.id);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await sourcesStore.delete(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (err) {
      setStorageError(describeError(err));
    }
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Load a rulebook</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use a public standard or regulation that is openly licensed or in the public domain. It is
          read and saved on this device. Its text goes to the cloud only when you press &lsquo;Make
          the cartridge&rsquo;, once.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Choose the document</CardTitle>
          <CardDescription>
            PDF, .txt or .md, up to 50 MB. Scanned PDFs are not supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="tablist" aria-label="How to load" className="flex gap-2">
            {(['file', 'paste'] as const).map((m) => (
              <Button
                key={m}
                role="tab"
                aria-selected={mode === m}
                variant={mode === m ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setMode(m);
                  resetDraft();
                }}
              >
                {m === 'file' ? 'Choose a file' : 'Paste text'}
              </Button>
            ))}
          </div>

          {mode === 'file' ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={fileId} className="text-sm font-medium">
                File
              </label>
              <input
                ref={fileInput}
                id={fileId}
                type="file"
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
            </div>
          ) : (
            <form onSubmit={readPaste} className="flex flex-col gap-2">
              <label htmlFor={pasteNameId} className="text-sm font-medium">
                Name
              </label>
              <input
                id={pasteNameId}
                className={inputClass}
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="For example: OWASP ASVS 5.0, chapter V6"
              />
              <label htmlFor={pasteId} className="text-sm font-medium">
                Text
              </label>
              <textarea
                id={pasteId}
                className={textareaClass}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={!pasteText.trim()}
              >
                Use this text
              </Button>
            </form>
          )}

          <div aria-live="polite">
            {busy && <p className="text-sm text-muted-foreground">{busy}</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle>2. Check and save</CardTitle>
            <CardDescription>
              This text is what every rule&apos;s quote will be checked against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-4">
              <SourceFacts s={draft} />
              {draft.warnings.map((w) => (
                <p
                  key={w.code}
                  role="alert"
                  className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
                >
                  {w.message}
                </p>
              ))}
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Show the start of the extracted text
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap">
                  {draft.text.slice(0, 3000)}
                  {draft.text.length > 3000 && '\n…'}
                </pre>
              </details>
              <div className="flex flex-col gap-2">
                <label htmlFor={licenceId} className="text-sm font-medium">
                  Licence
                </label>
                <input
                  id={licenceId}
                  className={inputClass}
                  value={licence}
                  onChange={(e) => setLicence(e.target.value)}
                  placeholder="For example: CC BY-SA 4.0, or Public domain (US government work)"
                  required
                />
              </div>
              <div className="flex items-start gap-2">
                <input
                  id={confirmId}
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <label htmlFor={confirmId} className="text-sm">
                  This is a public document, openly licensed or in the public domain. It is not my
                  own private material. I understand it will be sent to the cloud once, to make the
                  cartridge.
                </label>
              </div>
              <Button type="submit" className="self-start" disabled={!confirmed || !licence.trim()}>
                Save on this device
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="saved-title" className="flex flex-col gap-3">
        <h2 id="saved-title" className="text-lg font-semibold">
          Saved rulebooks
        </h2>
        {storageError && (
          <p role="alert" className="text-sm text-destructive">
            {storageError}
          </p>
        )}
        {saved === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rulebooks yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {saved.map((s) => (
              <SavedSource
                key={s.id}
                s={s}
                selected={selectedId === s.id}
                onSelect={() => setSelectedId(selectedId === s.id ? null : s.id)}
                onDelete={() => void remove(s.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <CartridgeList />
    </section>
  );
}
