/** Cartridges on this device: open, export, delete, and import from a file. */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { exportCartridgeJson, exportFileName, importCartridgeJson } from '@/cartridge/cartridgeIO';
import { compileJobs } from '@/cartridge/compileJob';
import { activeCartridge } from '@/cartridge/active';
import { cartridgesStore, sourcesStore, type CartridgeRecord } from '@/cartridge/store';
import { downloadText } from '@/ui/download';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler } from '@/ui/router';

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Row({ r, onChanged }: { r: CartridgeRecord; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportJson = async () => {
    try {
      const cur = await cartridgesStore.current(r.id);
      if (!cur) throw new Error('This cartridge is no longer on this device.');
      downloadText(exportFileName(cur.cartridge), exportCartridgeJson(cur.cartridge));
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async () => {
    try {
      await cartridgesStore.delete(r.id);
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium break-all">{r.name}</p>
          <p className="text-xs text-muted-foreground">
            Version {r.currentVersion}, {r.ruleCount} rules. Updated{' '}
            {new Date(r.updatedAt).toLocaleString()}.
            {r.sourceId === '' &&
              ' Its rulebook is not on this device, so quotes cannot be checked.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={href('/cartridge', { id: r.id })}
            onClick={linkHandler('/cartridge', { id: r.id })}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Open the cards
          </a>
          <Button variant="ghost" size="sm" onClick={() => void exportJson()}>
            Export JSON
          </Button>
          {confirming ? (
            <>
              <Button variant="destructive" size="sm" onClick={() => void remove()}>
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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function CartridgeList() {
  const importId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<CartridgeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Refresh when a 'Make the cartridge' job finishes.
  const jobs = useSyncExternalStore(compileJobs.subscribe, compileJobs.get);
  const doneCount = Object.values(jobs).filter((j) => j.status === 'done').length;

  const load = useCallback((isLive: () => boolean = () => true) => {
    return cartridgesStore.list().then(
      (list) => {
        if (isLive()) setRecords(list);
      },
      (e: unknown) => {
        if (!isLive()) return;
        setRecords([]);
        setError(`Cartridges are not available: ${message(e)}`);
      },
    );
  }, []);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load, doneCount]);

  const importFile = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const cartridge = importCartridgeJson(await file.text());
      const sources = await sourcesStore.list();
      const source = sources.find((s) => s.hash === cartridge.sourceHash);
      await cartridgesStore.saveVersion(cartridge, source?.id ?? '');
      activeCartridge.set(cartridge.id);
      setNotice(
        source
          ? `Imported '${cartridge.name}'. Its rulebook is on this device, so its quotes can be checked.`
          : `Imported '${cartridge.name}'. Its rulebook is not on this device: load the same rulebook to check its quotes.`,
      );
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section aria-labelledby="cartridges-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cartridges-title" className="text-lg font-semibold">
          Cartridges on this device
        </h2>
        <div>
          <label
            htmlFor={importId}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'cursor-pointer focus-within:ring-[3px] focus-within:ring-ring/50',
            })}
          >
            Import JSON
            <input
              ref={fileRef}
              id={importId}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
              }}
            />
          </label>
        </div>
      </div>
      <div aria-live="polite">
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {records === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cartridges yet. Make one from a saved rulebook above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {records.map((r) => (
            <Row key={r.id} r={r} onChanged={() => void load()} />
          ))}
        </ul>
      )}
    </section>
  );
}
