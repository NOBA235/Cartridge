/**
 * Report card: what the cartridge is, how it did on this device, whether its
 * quotes are still found in the rulebook, and the receipt of what ran here
 * and what left this device.
 */
import { useId, useMemo, useSyncExternalStore } from 'react';
import type { LoadedCartridge } from '@/cartridge/askSession';
import { verifyQuote } from '@/cartridge/verifyQuote';
import { examJobs } from '@/exam/examJob';
import { receipt } from '@/telemetry/receipt';
import { formatBytes, summariseEgress } from '@/telemetry/summary';
import { cartridgeLabel, useChosenCartridgeId } from '@/ui/activeCartridge';
import { ExamReportCard } from '@/ui/components/ExamReportCard';
import { egressPanel } from '@/ui/egressPanelState';
import { useCartridges, useLoadedCartridge } from '@/ui/hooks/useCartridges';
import { useEgressLog } from '@/ui/hooks/useStores';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, navigate, useLocation } from '@/ui/router';
import { inputClass } from '@/ui/styles';

function BigCartridge({ loaded }: { loaded: LoadedCartridge }) {
  const c = loaded.cartridge;
  const label = cartridgeLabel(c);
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-xl border bg-card shadow-lg"
      aria-label={`Cartridge: ${label.full}`}
    >
      <span aria-hidden className="w-3 shrink-0 bg-primary" />
      <div className="flex flex-1 flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{label.title}</p>
          <p className="text-sm text-muted-foreground">
            {label.rules}, {label.tested}. Version {c.version}.
          </p>
          {c.sourceLicence && (
            <p className="text-xs text-muted-foreground">Rulebook licence: {c.sourceLicence}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={href('/cartridge', { id: c.id })}
            onClick={linkHandler('/cartridge', { id: c.id })}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            Open the cards
          </a>
          <a
            href={href('/versions', { id: c.id })}
            onClick={linkHandler('/versions', { id: c.id })}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            Versions
          </a>
        </div>
      </div>
    </div>
  );
}

function SourceCheck({ loaded }: { loaded: LoadedCartridge }) {
  const result = useMemo(() => {
    if (!loaded.prepared) return undefined;
    const prepared = loaded.prepared;
    const failing = loaded.cartridge.rules.filter((r) => !verifyQuote(r.source.quote, prepared).ok);
    return { total: loaded.cartridge.rules.length, failing };
  }, [loaded]);
  return (
    <section aria-labelledby="source-title" className="flex flex-col gap-2 rounded-xl border p-5">
      <h2 id="source-title" className="text-lg font-semibold">
        Verified against the source
      </h2>
      {!result ? (
        <p className="text-sm text-warning">
          The rulebook is not on this device, so the quotes cannot be checked here.
        </p>
      ) : result.failing.length === 0 ? (
        <p className="text-sm">
          <span className="font-medium text-success">
            {result.total} of {result.total}
          </span>{' '}
          rule quotes were found in the rulebook, checked just now on this device.
        </p>
      ) : (
        <div className="text-sm">
          <p role="alert" className="text-destructive">
            {result.total - result.failing.length} of {result.total} rule quotes were found in the
            rulebook. Do not rely on these rules: {result.failing.map((r) => r.id).join(', ')}.
          </p>
        </div>
      )}
    </section>
  );
}

function Receipt() {
  const r = useSyncExternalStore(receipt.subscribe, receipt.get);
  const summary = summariseEgress(useEgressLog());
  return (
    <section
      aria-labelledby="receipt-title"
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-5"
    >
      <h2 id="receipt-title" className="text-lg font-semibold">
        Receipt
      </h2>
      <p className="text-base">
        {r.onDevice} answer{r.onDevice === 1 ? '' : 's'} on this device, {r.cloud} from the cloud,{' '}
        {formatBytes(summary.totalBytes)} left this device.
      </p>
      <p className="text-sm text-muted-foreground">
        {r.queued} question{r.queued === 1 ? '' : 's'} waited for signal; {r.unanswered} stayed
        unanswered on this device. You approved sending your own text {summary.approvals} time
        {summary.approvals === 1 ? '' : 's'}.
      </p>
      {summary.rows.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">What left this device, by purpose</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 font-normal">
                Purpose
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Requests
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Sent
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.purpose} className="border-b last:border-b-0">
                <td className="py-1.5">{row.label}</td>
                <td className="py-1.5 text-right tabular-nums">{row.requests}</td>
                <td className="py-1.5 text-right tabular-nums">{formatBytes(row.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing has left this device yet.</p>
      )}
      <Button size="sm" variant="outline" className="self-start" onClick={() => egressPanel.open()}>
        Show exactly what was sent
      </Button>
      <p className="text-xs text-muted-foreground">
        Counts cover everything done in this browser on this device. Calls to the on-device model
        send nothing.
      </p>
    </section>
  );
}

function ReportFor({ loaded }: { loaded: LoadedCartridge }) {
  const c = loaded.cartridge;
  return (
    <div className="flex flex-col gap-6">
      <BigCartridge loaded={loaded} />
      {c.report ? (
        <ExamReportCard
          title="Exam Day result"
          report={c.report}
          rules={c.rules}
          onOverride={() => examJobs.override(c.id)}
        />
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border p-5">
          <h2 className="text-lg font-semibold">Exam Day result</h2>
          <p className="text-sm text-muted-foreground">
            Version {c.version} has not been through Exam Day yet, so it is not tested on this
            device.
          </p>
          <a
            href={href('/exam', { id: c.id })}
            onClick={linkHandler('/exam', { id: c.id })}
            className={buttonVariants({ size: 'sm', className: 'self-start' })}
          >
            Go to Exam Day
          </a>
        </section>
      )}
      <SourceCheck loaded={loaded} />
      <Receipt />
    </div>
  );
}

export function ReportCard() {
  const { params } = useLocation();
  const selectId = useId();
  const { records, error } = useCartridges();
  const id = useChosenCartridgeId(records, params.get('id'));
  const loaded = useLoadedCartridge(id);

  const header = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Report card</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How this cartridge did on this device, and what left it.
      </p>
    </header>
  );

  if (records === null) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
        {header}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }
  if (records.length === 0) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
        {header}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Cartridges are not available: {error}
          </p>
        )}
        <p className="text-sm">
          There is no cartridge on this device yet, so there is nothing to report.
        </p>
        <a
          href="/load"
          onClick={linkHandler('/load')}
          className={buttonVariants({ className: 'self-start' })}
        >
          Load a rulebook
        </a>
        <Receipt />
      </section>
    );
  }

  const current =
    loaded !== null && loaded !== 'missing' && loaded.cartridge.id === id ? loaded : null;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      {header}
      {records.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-sm text-muted-foreground">
            Cartridge
          </label>
          <select
            id={selectId}
            className={`${inputClass} w-auto max-w-full`}
            value={id ?? ''}
            onChange={(e) => navigate('/report', { id: e.target.value })}
          >
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (v{r.currentVersion}, {r.ruleCount} rules)
              </option>
            ))}
          </select>
        </div>
      )}
      {loaded === 'missing' && (
        <p role="alert" className="text-sm">
          This cartridge is not on this device.
        </p>
      )}
      {current ? (
        <ReportFor loaded={current} />
      ) : (
        loaded !== 'missing' && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
