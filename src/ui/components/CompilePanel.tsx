/**
 * 'Make the cartridge' for one saved rulebook: the button, live progress
 * ('Reading section 3 of 12', 'Verified 38 of 41 quotes'), and the result
 * with every left-out rule and its reason.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { chunkSource } from '@/cartridge/chunker';
import { compileJobs, type CompileJob } from '@/cartridge/compileJob';
import type { DroppedRule, SectionFailure } from '@/cartridge/compile';
import type { SourceDoc } from '@/cartridge/source';
import { config } from '@/config';
import { useOnline } from '@/ui/hooks/useStores';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { linkHandler, href } from '@/ui/router';

function useJob(sourceId: string): CompileJob | undefined {
  return useSyncExternalStore(compileJobs.subscribe, () => compileJobs.get()[sourceId]);
}

function LeftOut({
  dropped,
  failedSections,
}: {
  dropped: DroppedRule[];
  failedSections: SectionFailure[];
}) {
  if (dropped.length === 0 && failedSections.length === 0) return null;
  return (
    <details className="rounded-lg border p-3" open={dropped.length <= 8}>
      <summary className="cursor-pointer text-sm font-medium">
        Left out: {dropped.length} rule{dropped.length === 1 ? '' : 's'}
        {failedSections.length > 0 &&
          `, ${failedSections.length} section${failedSections.length === 1 ? '' : 's'} not read`}
      </summary>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {failedSections.map((f) => (
          <li key={`s${f.section}`} className="text-destructive">
            Section {f.section} could not be read: {f.error}
          </li>
        ))}
        {dropped.map((d, i) => (
          <li key={i}>
            <span className="font-medium">{d.title}</span>
            {d.section !== undefined && (
              <span className="text-muted-foreground"> (section {d.section})</span>
            )}
            <span className="text-muted-foreground">: {d.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function CompilePanel({ source }: { source: SourceDoc }) {
  const job = useJob(source.id);
  const online = useOnline();
  const sections = useMemo(
    () => chunkSource(source, { maxChars: config.compile.maxChunkChars }).length,
    [source],
  );

  if (job?.status === 'running') {
    const fraction = job.sectionCount > 0 ? (job.section - 0.5) / job.sectionCount : 0;
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3" aria-live="polite">
        <progress
          className="h-2 w-full accent-primary"
          value={job.finishing ? 1 : Math.max(0, fraction)}
          max={1}
          aria-label="Progress"
        />
        <p className="text-sm">
          {job.finishing
            ? 'Removing duplicates and numbering the rules…'
            : job.sectionCount > 0
              ? `Reading section ${job.section} of ${job.sectionCount}${job.repairing ? ', asking again for exact quotes' : ''}…`
              : 'Starting…'}
        </p>
        {job.checked > 0 && (
          <p className="text-sm text-muted-foreground">
            Verified {job.verified} of {job.checked} quotes
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => compileJobs.stop(source.id)}
        >
          Stop after this section
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {job?.status === 'done' && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/5 p-3"
          role="status"
        >
          <p className="text-sm font-medium">
            Cartridge ready: {job.kept} rule{job.kept === 1 ? '' : 's'}, every quote verified
            against the source.
          </p>
          <p className="text-xs text-muted-foreground">
            {job.stats.sectionsRead} of {job.stats.sections} sections read. Verified{' '}
            {job.stats.verified} of {job.stats.checked} quotes ({job.stats.repaired} after asking
            again).
          </p>
          {job.notes.length > 0 && (
            <ul className="text-xs text-muted-foreground">
              {job.notes.map((n, i) => (
                <li key={i}>
                  {n.title}: {n.message}
                </li>
              ))}
            </ul>
          )}
          <a
            href={href('/cartridge', { id: job.cartridgeId })}
            onClick={linkHandler('/cartridge', { id: job.cartridgeId })}
            className={buttonVariants({ size: 'sm', className: 'self-start' })}
          >
            Open the cards
          </a>
          <LeftOut dropped={job.dropped} failedSections={job.failedSections} />
        </div>
      )}
      {job?.status === 'failed' && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p role="alert" className="text-sm text-destructive">
            The cartridge was not made. {job.error}
          </p>
          <LeftOut dropped={job.dropped} failedSections={job.failedSections} />
        </div>
      )}
      {job?.status === 'stopped' && (
        <p className="text-sm text-muted-foreground">Stopped. Nothing was saved.</p>
      )}

      <div className="flex flex-col gap-1">
        <Button className="self-start" onClick={() => compileJobs.start(source)} disabled={!online}>
          {job?.status === 'done' ? 'Make the cartridge again' : 'Make the cartridge'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {online
            ? `Sends this rulebook's text to the cloud once, in ${sections} section${sections === 1 ? '' : 's'}. Every call shows in 'What left this device'.`
            : 'No signal. Making the cartridge needs the cloud once.'}
        </p>
      </div>
    </div>
  );
}
