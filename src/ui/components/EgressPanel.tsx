import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Button } from '@/ui/primitives/button';
import type { EgressEntry } from '@/telemetry/egress';
import { formatBytes } from '@/telemetry/summary';
import { useEgressLog, useEgressPersistence } from '@/ui/hooks/useStores';

const KIND_LABEL: Record<EgressEntry['kind'], string> = {
  'cloud-call': 'Sent to the cloud',
  declassify: 'You approved sending',
  'unexpected-cloud': 'Unexpected: device call reported cloud',
  probe: 'Signal check (no content)',
};

function Entry({ e }: { e: EgressEntry }) {
  return (
    <li className="rounded-lg border bg-background/50 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={e.kind === 'unexpected-cloud' ? 'font-medium text-destructive' : 'font-medium'}
        >
          {KIND_LABEL[e.kind]}
        </span>
        <time className="text-xs text-muted-foreground" dateTime={e.at}>
          {new Date(e.at).toLocaleTimeString()}
        </time>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>For</dt>
        <dd>{e.label}</dd>
        {e.model && (
          <>
            <dt>Model</dt>
            <dd>{e.model}</dd>
          </>
        )}
        {e.attempt !== undefined && (
          <>
            <dt>Attempt</dt>
            <dd>{e.attempt}</dd>
          </>
        )}
        <dt>Bytes sent</dt>
        <dd>{formatBytes(e.bytesSent)}</dd>
        <dt>Result</dt>
        <dd>{e.status === 'ok' ? 'OK' : `Failed: ${e.error ?? 'unknown error'}`}</dd>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Show exactly what was {e.kind === 'declassify' ? 'approved' : 'sent'}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {e.preview}
        </pre>
      </details>
    </li>
  );
}

export function EgressPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const entries = useEgressLog();
  const persistence = useEgressPersistence();
  const total = entries.reduce((s, e) => s + e.bytesSent, 0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const still = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) return;
    // Return focus to whatever opened the panel when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="egress"
          role="dialog"
          aria-modal="false"
          aria-labelledby="egress-title"
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-card shadow-xl"
          initial={still ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={still ? { opacity: 0 } : { x: '100%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <header className="flex items-center justify-between border-b p-4">
            <div>
              <h2 id="egress-title" className="text-base font-semibold">
                What left this device
              </h2>
              <p className="text-xs text-muted-foreground">
                {entries.filter((e) => e.kind === 'cloud-call').length} cloud calls,{' '}
                {formatBytes(total)} sent in total
              </p>
            </div>
            <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has left this device yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {[...entries].reverse().map((e) => (
                  <Entry key={e.id} e={e} />
                ))}
              </ol>
            )}
          </div>
          <footer className="border-t p-4 text-xs text-muted-foreground">
            {persistence === 'saved' &&
              'This log is stored on this device and kept after a reload. '}
            {persistence === 'failed' &&
              'This log could not be stored on this device, so it only covers this session. '}
            {persistence === 'memory' && 'Loading earlier entries… '}
            Calls to the on-device model are not listed because nothing leaves the device.
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
