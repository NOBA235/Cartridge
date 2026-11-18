/**
 * The connection test: before the Blueprint canvas may mark connections red
 * or green, Gemini Nano must pass 30 reviewed connections on this device,
 * three times, the lowest run counting. Until then the canvas can only advise.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  BenchError,
  benchProblems,
  canvasMode,
  cartridgeProblems,
  exportBenchJson,
  importBenchJson,
  STATUS_WORDS,
} from '@/canvas/bench';
import { benchJobs, type BenchJob } from '@/canvas/benchJob';
import {
  BENCH_COMPOSITION,
  type BenchItem,
  type EdgeBench,
  type EdgeBenchReport,
  type ExpectedStatus,
} from '@/canvas/benchTypes';
import { formatEdge } from '@/canvas/edges';
import type { LoadedCartridge } from '@/cartridge/askSession';
import { benchesStore } from '@/cartridge/store';
import type { Cartridge } from '@/cartridge/types';
import { config } from '@/config';
import { storageErrorMessage } from '@/lib/storageErrors';
import { useChosenCartridgeId } from '@/ui/activeCartridge';
import { useDeviceState } from '@/ui/components/DevicePanel';
import { NoCartridge } from '@/ui/components/NoCartridge';
import { useConnectivity } from '@/ui/components/NoSignalSwitch';
import { downloadText } from '@/ui/download';
import { useCartridges, useDataVersion, useLoadedCartridge } from '@/ui/hooks/useCartridges';
import { Button } from '@/ui/primitives/button';
import { navigate, useLocation } from '@/ui/router';
import { inputClass } from '@/ui/styles';

const STATUS_LABEL: Record<string, string> = {
  VIOLATION: 'Violation',
  COMPLIANT: 'Compliant',
  COMPLIANT_VIA_EXCEPTION: 'Allowed by an exception',
  OUT_OF_SCOPE: 'Not covered',
  UNCERTAIN: 'Uncertain',
};
const EXPECTED: ExpectedStatus[] = [
  'VIOLATION',
  'COMPLIANT',
  'COMPLIANT_VIA_EXCEPTION',
  'OUT_OF_SCOPE',
];
const pct = (x: number) => `${Math.round(x * 100)}%`;

function useJob(id: string): BenchJob | undefined {
  return useSyncExternalStore(benchJobs.subscribe, () => benchJobs.get()[id]);
}

function useBench(id: string): EdgeBench | null | undefined {
  const data = useDataVersion();
  const [bench, setBench] = useState<{ id: string; bench: EdgeBench | null } | undefined>();
  useEffect(() => {
    let live = true;
    benchesStore.get(id).then(
      (b) => live && setBench({ id, bench: b ?? null }),
      () => live && setBench({ id, bench: null }),
    );
    return () => {
      live = false;
    };
  }, [id, data]);
  return bench?.id === id ? bench.bench : undefined;
}

function Result({ report, cartridge }: { report: EdgeBenchReport; cartridge: Cartridge }) {
  const lowest = report.runs[report.lowestRun];
  const mode = canvasMode({ edgeBench: report });
  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="result-title" className="text-lg font-semibold">
          Result for version {cartridge.version}
        </h2>
        <span
          className={
            mode === 'verdict'
              ? 'rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success'
              : 'rounded-full border border-warning/50 bg-warning/10 px-3 py-1 text-xs font-medium text-warning'
          }
        >
          {mode === 'verdict' ? 'Verdict mode' : 'Advisory mode'}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {report.measuredOn === 'device' ? 'Tested on this device' : 'Not measured on a real device'}
        , {new Date(report.ranAt).toLocaleString()}. The lowest of {report.runs.length} runs counts.
      </p>
      {lowest && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Violations caught</dt>
          <dd>
            {lowest.violationsFlagged} of {lowest.violations} ({pct(report.criticalRecall)}; the bar
            is {pct(report.thresholds.criticalRecall)})
          </dd>
          <dt className="text-muted-foreground">Test pass rate</dt>
          <dd>
            {lowest.correct} of {lowest.total} right ({pct(report.overallAccuracy)}; the bar is{' '}
            {pct(report.thresholds.overallAccuracy)})
          </dd>
          {report.medianLatencyMs !== undefined && (
            <>
              <dt className="text-muted-foreground">Median time per connection</dt>
              <dd>{Math.round(report.medianLatencyMs)} ms</dd>
            </>
          )}
          <dt className="text-muted-foreground">Every run</dt>
          <dd>
            {report.runs
              .map(
                (r, i) =>
                  `run ${i + 1}: ${r.violationsFlagged}/${r.violations} caught, ${r.correct}/${r.total} right`,
              )
              .join('; ')}
          </dd>
        </dl>
      )}
      {report.missedViolations.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium text-destructive">
            Missed violations ({report.missedViolations.length}), the worst kind of failure:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {report.missedViolations.map((m) => (
              <li key={m.id}>
                {m.edge}: expected a violation of {m.expectedRuleId}, got{' '}
                {STATUS_LABEL[m.got]?.toLowerCase()}
                {m.gotRuleId ? ` (${m.gotRuleId})` : ''}.
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.wrongRule.length > 0 && (
        <p className="text-sm text-warning">
          Flagged as a violation but of another rule: {report.wrongRule.join(', ')}.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {mode === 'verdict'
          ? 'The Blueprint canvas may show red for violations and green for compliant connections with these rules.'
          : 'Below the bar, the Blueprint canvas only advises: amber "Possible violation, review", and no green.'}
      </p>
    </section>
  );
}

function Row({
  item,
  rules,
  onChange,
}: {
  item: BenchItem;
  rules: Cartridge['rules'];
  onChange: (next: BenchItem) => void;
}) {
  const statusId = useId();
  const ruleId = useId();
  return (
    <tr className="border-b align-top last:border-b-0">
      <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">{item.id}</td>
      <td className="py-2 pr-2">
        <span className="break-words">{formatEdge(item)}</span>
        {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
      </td>
      <td className="py-2 pr-2">
        <label htmlFor={statusId} className="sr-only">
          Expected result for {item.id}
        </label>
        <select
          id={statusId}
          className={`${inputClass} h-8 w-auto py-0 text-xs`}
          value={item.expectedStatus}
          onChange={(e) => {
            const expectedStatus = e.target.value as ExpectedStatus;
            onChange({
              ...item,
              expectedStatus,
              expectedRuleId: expectedStatus === 'OUT_OF_SCOPE' ? null : item.expectedRuleId,
            });
          }}
        >
          {EXPECTED.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2">
        <label htmlFor={ruleId} className="sr-only">
          Rule for {item.id}
        </label>
        <select
          id={ruleId}
          className={`${inputClass} h-8 w-auto py-0 text-xs`}
          value={item.expectedRuleId ?? ''}
          disabled={item.expectedStatus === 'OUT_OF_SCOPE'}
          onChange={(e) => onChange({ ...item, expectedRuleId: e.target.value || null })}
        >
          <option value="">No rule</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} ({r.severity})
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function TestFor({ loaded }: { loaded: LoadedCartridge }) {
  const c = loaded.cartridge;
  const bench = useBench(c.id);
  const job = useJob(c.id);
  const device = useDeviceState(c);
  const online = useConnectivity();
  const cloudOk = online.browserOnline && !online.simulatedOffline;
  const reviewedId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const unsuitable = cartridgeProblems(c);
  const problems = bench ? benchProblems(bench, c) : [];
  const busy = job?.status === 'drafting' || job?.status === 'running';

  const save = async (next: EdgeBench) => {
    setError(null);
    try {
      await benchesStore.put(next);
    } catch (e) {
      setError(storageErrorMessage(e, 'the connections'));
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      if (file.size > config.maxImportBytes)
        throw new BenchError('This file is too large.', 'NOT_SUITABLE');
      await save({ ...importBenchJson(await file.text()), reviewed: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const blocked = !bench
    ? 'Draft or import the connections first.'
    : problems.length > 0
      ? 'Fix the problems listed above first.'
      : !bench.reviewed
        ? 'Confirm you reviewed every connection first.'
        : !loaded.prepared
          ? 'The rulebook for this cartridge is not on this device, so no quote can be checked. Load the same rulebook first.'
          : device.state !== 'ready'
            ? 'Gemini Nano is not ready on this device. Prepare this device first (header or Ask screen).'
            : null;

  return (
    <div className="flex flex-col gap-6">
      {c.edgeBench ? (
        <Result report={c.edgeBench} cartridge={c} />
      ) : (
        <p className="rounded-xl border p-5 text-sm">
          Version {c.version} has not been through the connection test, so the Blueprint canvas
          would be in <span className="font-medium text-warning">advisory mode</span>: no red or
          green verdicts.
        </p>
      )}

      <section aria-labelledby="set-title" className="flex flex-col gap-3 rounded-xl border p-5">
        <h2 id="set-title" className="text-lg font-semibold">
          1. The connections
        </h2>
        <p className="text-sm text-muted-foreground">
          {Object.entries(BENCH_COMPOSITION)
            .map(([s, n]) => `${n} ${STATUS_WORDS[s as ExpectedStatus]}`)
            .join(', ')}
          , written by the cloud from the public rules only (no quotes, nothing of yours). Check
          every one by hand and correct the expected result where it is wrong.
        </p>
        {unsuitable.map((p) => (
          <p key={p} role="alert" className="text-sm text-warning">
            {p}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={bench ? 'outline' : 'default'}
            disabled={busy || !cloudOk || unsuitable.length > 0}
            onClick={() => benchJobs.draft(c.id)}
          >
            {job?.status === 'drafting'
              ? 'Drafting…'
              : bench
                ? 'Draft new connections (replaces these)'
                : 'Draft 30 connections'}
          </Button>
          <label className="inline-flex">
            <span className="sr-only">Import a connections file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
              }}
            />
          </label>
          {bench && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadText('edges.json', exportBenchJson(bench))}
            >
              Export edges.json
            </Button>
          )}
        </div>
        {!cloudOk && !bench && (
          <p className="text-xs text-muted-foreground">No signal. Drafting needs the cloud once.</p>
        )}
        <div aria-live="polite">
          {job?.status === 'drafted' && job.dropped > 0 && (
            <p className="text-sm text-muted-foreground">
              {job.dropped} drafted connection{job.dropped === 1 ? ' was' : 's were'} left out
              (incomplete, or naming a rule that is not in this cartridge).
            </p>
          )}
          {job?.status === 'failed' && (
            <p role="alert" className="text-sm text-destructive">
              {job.error}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        {bench === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bench === null ? (
          <p className="text-sm text-muted-foreground">No connections yet.</p>
        ) : (
          <>
            {problems.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-sm text-warning">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Connections and their expected results</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-2 font-normal">
                      ID
                    </th>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Connection
                    </th>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Expected
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      Rule
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bench.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      rules={c.rules}
                      onChange={(next) =>
                        void save({
                          ...bench,
                          reviewed: false,
                          items: bench.items.map((i) => (i.id === next.id ? next : i)),
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-start gap-2">
              <input
                id={reviewedId}
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={bench.reviewed}
                disabled={problems.length > 0}
                onChange={(e) => void save({ ...bench, reviewed: e.target.checked })}
              />
              <label htmlFor={reviewedId} className="text-sm">
                I have checked every connection and its expected result by hand.
              </label>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="run-title" className="flex flex-col gap-3 rounded-xl border p-5">
        <h2 id="run-title" className="text-lg font-semibold">
          2. Run on this device
        </h2>
        <p className="text-sm text-muted-foreground">
          Gemini Nano sees one connection at a time and up to {config.edgeBench.topK} rules, and
          reports facts; code decides the result. Nothing is sent to the cloud. The test runs{' '}
          {config.edgeBench.runs} times and the lowest run counts. The bar: at least{' '}
          {pct(config.edgeBench.minCriticalRecall)} of violations caught and a test pass rate of at
          least {pct(config.edgeBench.minOverallAccuracy)}.
        </p>
        {job?.status === 'running' ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <progress
              className="h-2 w-full accent-primary"
              aria-label="Progress"
              value={
                job.runs > 0 ? ((job.run - 1) * job.items + job.item) / (job.runs * job.items) : 0
              }
              max={1}
            />
            <p className="text-sm">
              {job.runs > 0
                ? `Run ${job.run} of ${job.runs}, connection ${job.item} of ${job.items}…`
                : 'Starting…'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => benchJobs.stop(c.id)}
            >
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Button
              className="self-start"
              disabled={blocked !== null || busy}
              onClick={() => benchJobs.run(c.id)}
            >
              Run the test {config.edgeBench.runs} times
            </Button>
            {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
          </div>
        )}
        {job?.status === 'stopped' && (
          <p className="text-sm text-muted-foreground">Stopped. Nothing was saved.</p>
        )}
        {job?.status === 'done' && job.version === c.version && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Every connection, lowest run
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {job.results.map((r) => {
                const item = bench?.items.find((i) => i.id === r.id);
                return (
                  <li key={r.id}>
                    <span aria-hidden>{r.correct ? '✓' : '✗'}</span>
                    <span className="sr-only">{r.correct ? 'Right' : 'Wrong'}:</span>{' '}
                    {item ? formatEdge(item) : r.id}: expected{' '}
                    {STATUS_LABEL[r.expected]?.toLowerCase()}
                    {r.expectedRuleId ? ` (${r.expectedRuleId})` : ''}, got{' '}
                    {STATUS_LABEL[r.verdict.status]?.toLowerCase()}
                    {r.verdict.rule ? ` (${r.verdict.rule.id})` : ''}.{' '}
                    <span className="text-muted-foreground">{r.verdict.detail}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

export function ConnectionTest() {
  const { params } = useLocation();
  const selectId = useId();
  const { records } = useCartridges();
  const id = useChosenCartridgeId(records, params.get('id'));
  const loaded = useLoadedCartridge(id);

  const header = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Connection test</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The Blueprint canvas checks each connection in a diagram against the rules, on this device.
        It may show red and green only after Gemini Nano passes this test here; until then it only
        advises.
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
  if (records.length === 0) return <NoCartridge>{header}</NoCartridge>;

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
            onChange={(e) => navigate('/connections', { id: e.target.value })}
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
        <TestFor key={`${current.cartridge.id}@${current.cartridge.version}`} loaded={current} />
      ) : (
        loaded !== 'missing' && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
