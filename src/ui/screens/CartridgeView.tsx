/**
 * Card viewer: every rule of a cartridge, searchable, filterable by severity,
 * with its quote highlighted in the rulebook. 'Verified against the source'
 * is shown only when the quote check passes right here, on this device.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { describeCalc } from '@/cartridge/calc';
import { exportCartridgeJson, exportFileName } from '@/cartridge/cartridgeIO';
import type { SourceDoc } from '@/cartridge/source';
import { cartridgesStore, sourcesStore, type CartridgeRecord } from '@/cartridge/store';
import type { Cartridge, Rule, Severity } from '@/cartridge/types';
import { prepareSource, verifyQuote, type PreparedSource } from '@/cartridge/verifyQuote';
import { cn } from '@/lib/utils';
import { ReadyBadge } from '@/ui/components/ExamReportCard';
import { SEVERITIES, SeverityChip } from '@/ui/components/SeverityChip';
import { SourceContext } from '@/ui/components/SourceContext';
import { downloadText } from '@/ui/download';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, useLocation } from '@/ui/router';
import { inputClass } from '@/ui/styles';

type Loaded =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; record: CartridgeRecord; cartridge: Cartridge; source?: SourceDoc };

async function loadCartridge(id: string): Promise<Loaded> {
  const cur = await cartridgesStore.current(id);
  if (!cur) return { state: 'missing' };
  let source = cur.record.sourceId ? await sourcesStore.get(cur.record.sourceId) : undefined;
  if (!source)
    source = (await sourcesStore.list()).find((s) => s.hash === cur.cartridge.sourceHash);
  if (source && source.hash !== cur.cartridge.sourceHash) source = undefined;
  return {
    state: 'ready',
    record: cur.record,
    cartridge: cur.cartridge,
    ...(source ? { source } : {}),
  };
}

function matches(rule: Rule, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = [
    rule.id,
    rule.title,
    rule.when,
    rule.then,
    rule.notWhen ?? '',
    ...rule.keywords,
    ...rule.exceptions,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

function Verification({
  rule,
  source,
  prepared,
}: {
  rule: Rule;
  source?: SourceDoc;
  prepared?: PreparedSource;
}) {
  const result = useMemo(
    () => (prepared ? verifyQuote(rule.source.quote, prepared) : undefined),
    [rule, prepared],
  );
  if (!source || !prepared) {
    return (
      <p className="text-sm text-muted-foreground">
        Not checked: the rulebook this cartridge was made from is not on this device.
      </p>
    );
  }
  if (!result?.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This quote was not found in the rulebook. Do not rely on this rule.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-success">
        Verified against the source{result.page !== undefined && `, page ${result.page}`}
      </p>
      <SourceContext text={source.text} start={result.start} end={result.end} />
    </div>
  );
}

function RuleCard({
  rule,
  source,
  prepared,
}: {
  rule: Rule;
  source?: SourceDoc;
  prepared?: PreparedSource;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <li className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full flex-col gap-1 rounded-lg p-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">{rule.id}</span>
          <span className="font-medium">{rule.title}</span>
          <SeverityChip severity={rule.severity} />
        </span>
        <span className="text-sm text-muted-foreground">When: {rule.when}</span>
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-3 border-t p-4 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">What to do</p>
            <p>{rule.then}</p>
          </div>
          {rule.notWhen && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Not when</p>
              <p>{rule.notWhen}</p>
            </div>
          )}
          {rule.exceptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Exceptions</p>
              <ul className="list-disc pl-5">
                {rule.exceptions.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {rule.calc && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Calculation</p>
              <p className="font-mono text-xs">{describeCalc(rule.calc)}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">
              Source{rule.source.section && `: ${rule.source.section}`}
            </p>
            <Verification rule={rule} source={source} prepared={prepared} />
          </div>
          {rule.keywords.length > 0 && (
            <p className="text-xs text-muted-foreground">Asked as: {rule.keywords.join(', ')}</p>
          )}
        </div>
      )}
    </li>
  );
}

export function CartridgeView() {
  const { params } = useLocation();
  const id = params.get('id') ?? '';
  const searchId = useId();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<Severity>>(new Set());

  useEffect(() => {
    let live = true;
    loadCartridge(id).then(
      (l) => live && setLoaded(l),
      (e: unknown) =>
        live && setLoaded({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const source = loaded.state === 'ready' ? loaded.source : undefined;
  const prepared = useMemo(() => (source ? prepareSource(source) : undefined), [source]);

  if (loaded.state === 'loading')
    return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;
  if (loaded.state !== 'ready') {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
        <p role="alert" className="text-sm">
          {loaded.state === 'missing'
            ? 'This cartridge is not on this device.'
            : `The cartridge could not be opened: ${loaded.message}`}
        </p>
        <a
          href="/load"
          onClick={linkHandler('/load')}
          className={buttonVariants({ variant: 'outline', className: 'self-start' })}
        >
          Back to Load a rulebook
        </a>
      </section>
    );
  }

  const { cartridge } = loaded;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = cartridge.rules.filter((r) => !hidden.has(r.severity) && matches(r, words));
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, cartridge.rules.filter((r) => r.severity === s).length]),
  ) as Record<Severity, number>;

  const toggle = (s: Severity) => {
    const next = new Set(hidden);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setHidden(next);
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      <header className="flex flex-col gap-3">
        <a
          href={href('/load')}
          onClick={linkHandler('/load')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Load a rulebook
        </a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight break-all">{cartridge.name}</h1>
            <p className="text-sm text-muted-foreground">
              Version {cartridge.version}, {cartridge.rules.length} rules.
              {cartridge.sourceLicence && ` Rulebook licence: ${cartridge.sourceLicence}.`}
            </p>
            {cartridge.report ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <ReadyBadge report={cartridge.report} />
                <span className="text-muted-foreground">
                  {cartridge.report.measuredOn === 'device'
                    ? 'Tested on this device'
                    : 'Not measured on a real device'}
                  {cartridge.report.counts &&
                    `: passed ${cartridge.report.counts.heldOut.passed} of ${cartridge.report.counts.heldOut.total} held-out questions`}
                  .
                </span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not tested on this device yet.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={href('/exam', { id: cartridge.id })}
              onClick={linkHandler('/exam', { id: cartridge.id })}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              Exam Day
            </a>
            <a
              href={href('/ask', { id: cartridge.id })}
              onClick={linkHandler('/ask', { id: cartridge.id })}
              className={buttonVariants({ size: 'sm' })}
            >
              Ask this cartridge
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(exportFileName(cartridge), exportCartridgeJson(cartridge))
              }
            >
              Export JSON
            </Button>
          </div>
        </div>
        {!source && (
          <p
            role="status"
            className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
          >
            The rulebook this cartridge was made from is not on this device, so no quote can be
            checked. Load the same rulebook to check them.
          </p>
        )}
      </header>

      <div className="flex flex-col gap-3">
        <label htmlFor={searchId} className="sr-only">
          Search the rules
        </label>
        <input
          id={searchId}
          type="search"
          className={inputClass}
          placeholder="Search the rules"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show severity">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={!hidden.has(s)}
              onClick={() => toggle(s)}
              className={cn(
                'rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                hidden.has(s) && 'opacity-40',
              )}
            >
              <SeverityChip severity={s} count={counts[s]} className="cursor-pointer" />
              <span className="sr-only">{hidden.has(s) ? ` (hidden)` : ''}</span>
            </button>
          ))}
          <span className="self-center text-xs text-muted-foreground">
            Showing {visible.length} of {cartridge.rules.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rule matches.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => (
            <RuleCard key={r.id} rule={r} source={source} prepared={prepared} />
          ))}
        </ul>
      )}

      {cartridge.changelog.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Changes
          </summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {cartridge.changelog.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
