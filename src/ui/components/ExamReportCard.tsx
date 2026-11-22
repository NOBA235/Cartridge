/**
 * The Exam Day report. Wording: 'test pass rate', never 'accuracy'. A report
 * produced with the test stand-in says 'Not measured on a real device'.
 */
import { useState } from 'react';
import type { ExamReport, Rule } from '@/cartridge/types';
import { Button } from '@/ui/primitives/button';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function ScoreRing({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | null;
  sub: string;
  tone: 'ok' | 'bad' | 'neutral';
}) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value));
  const stroke =
    tone === 'ok' ? 'stroke-success' : tone === 'bad' ? 'stroke-destructive' : 'stroke-primary';
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <svg aria-hidden="true" viewBox="0 0 56 56" className="size-12 shrink-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-border" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          className={stroke}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-base font-semibold tabular-nums">{value === null ? '—' : pct(value)}</p>
        <p className="text-xs font-medium">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bar,
  ok,
}: {
  label: string;
  value: string;
  bar?: string;
  ok?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b py-2 text-sm last:border-b-0">
      <dt>
        {label}
        {bar && <span className="block text-xs text-muted-foreground">{bar}</span>}
      </dt>
      <dd
        className={
          ok === undefined
            ? 'font-medium'
            : ok
              ? 'font-medium text-success'
              : 'font-medium text-destructive'
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function ReadyBadge({ report }: { report: ExamReport }) {
  if (report.ready) {
    return (
      <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
        Ready
      </span>
    );
  }
  if (report.overridden) {
    return (
      <span className="rounded-full border border-warning/50 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
        Marked ready by you, below the bar
      </span>
    );
  }
  return (
    <span className="rounded-full border border-warning/50 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
      Needs review
    </span>
  );
}

export function MeasuredOn({ report }: { report: ExamReport }) {
  return report.measuredOn === 'device' ? (
    <p className="text-sm text-muted-foreground">Tested on this device (Gemini Nano).</p>
  ) : (
    <p
      role="status"
      className="rounded-lg border border-warning/50 bg-warning/10 p-2 text-sm text-warning"
    >
      Not measured on a real device.
    </p>
  );
}

function rulesLabel(id: string, byId: ReadonlyMap<string, Rule>): string {
  if (id === 'NONE') return 'No rule (not covered)';
  if (id === 'ERROR') return 'No answer (device error)';
  const r = byId.get(id);
  return r ? `${id} ${r.title}` : id;
}

export function ExamReportCard({
  report,
  rules,
  onOverride,
  title = 'Exam Day result',
}: {
  report: ExamReport;
  rules: readonly Rule[];
  onOverride?: () => Promise<void>;
  title?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const c = report.counts;
  const t = report.thresholds;
  const crit = c?.heldOutCritical;
  const out = c?.heldOutOutOfScope;

  return (
    <section
      aria-labelledby="report-title"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="report-title" className="text-lg font-semibold">
          {title}
        </h2>
        <ReadyBadge report={report} />
      </header>
      <MeasuredOn report={report} />

      <div className="grid gap-3 sm:grid-cols-3">
        <ScoreRing
          label="Held-out pass rate"
          value={report.heldOutPassRate}
          sub={c ? `${c.heldOut.passed} of ${c.heldOut.total} unseen` : 'Unseen questions'}
          tone={report.heldOutPassRate >= 0.75 ? 'ok' : 'neutral'}
        />
        <ScoreRing
          label="Critical rules"
          value={crit && crit.total === 0 ? null : report.criticalPassRate}
          sub={`Bar: ≥ ${pct(t?.criticalPassRate ?? 0.9)}`}
          tone={
            crit && crit.total === 0
              ? 'neutral'
              : report.criticalPassRate >= (t?.criticalPassRate ?? 0.9)
                ? 'ok'
                : 'bad'
          }
        />
        <ScoreRing
          label="Out-of-scope “none”"
          value={out && out.total === 0 ? null : report.outOfScopeRate}
          sub={`Bar: ≥ ${pct(t?.outOfScopeRate ?? 0.8)}`}
          tone={
            out && out.total === 0
              ? 'neutral'
              : report.outOfScopeRate >= (t?.outOfScopeRate ?? 0.8)
                ? 'ok'
                : 'bad'
          }
        />
      </div>

      <dl>
        <Row
          label="Test pass rate, practice"
          value={
            c
              ? `${c.practiceStart.passed} → ${c.practice.passed} of ${c.practice.total}`
              : pct(report.passRate)
          }
          bar={
            c
              ? `Before and after ${report.tutorRounds ?? 0} tutor round${report.tutorRounds === 1 ? '' : 's'}`
              : undefined
          }
        />
        <Row
          label="Test pass rate, held-out"
          value={
            c
              ? `${c.heldOut.passed} of ${c.heldOut.total} (${pct(report.heldOutPassRate)})`
              : pct(report.heldOutPassRate)
          }
          bar="Questions the tutor never saw, asked once at the end"
        />
        <Row
          label="Critical rules, held-out"
          value={
            crit && crit.total === 0
              ? 'Not checked'
              : crit
                ? `${crit.passed} of ${crit.total} (${pct(report.criticalPassRate)})`
                : pct(report.criticalPassRate)
          }
          bar={t ? `Ready needs ${pct(t.criticalPassRate)} or more` : undefined}
          ok={
            crit && crit.total === 0
              ? undefined
              : report.criticalPassRate >= (t?.criticalPassRate ?? 0.9)
          }
        />
        <Row
          label="Out of scope answered “not covered”, held-out"
          value={
            out && out.total === 0
              ? 'Not checked'
              : out
                ? `${out.passed} of ${out.total} (${pct(report.outOfScopeRate)})`
                : pct(report.outOfScopeRate)
          }
          bar={t ? `Ready needs ${pct(t.outOfScopeRate)} or more` : undefined}
          ok={
            out && out.total === 0 ? undefined : report.outOfScopeRate >= (t?.outOfScopeRate ?? 0.8)
          }
        />
        {report.medianLatencyMs !== undefined && (
          <Row
            label="Typical time per answer on this device"
            value={`${(report.medianLatencyMs / 1000).toFixed(1)} s`}
          />
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        Ran {new Date(report.ranAt).toLocaleString()}.
      </p>

      {report.notes && report.notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {report.failures.length > 0 && (
        <details open={report.failures.length <= 6}>
          <summary className="cursor-pointer text-sm font-medium">
            Failed questions ({report.failures.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {report.failures.map((f, i) => (
              <li key={i} className="rounded-lg border p-2">
                <p>{f.question}</p>
                <p className="text-xs text-muted-foreground">
                  {f.set === 'held-out' ? 'Held-out. ' : f.set === 'practice' ? 'Practice. ' : ''}
                  Expected {rulesLabel(f.expected, byId)}; the device chose{' '}
                  {rulesLabel(f.predicted, byId)}.
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {onOverride && !report.ready && !report.overridden && (
        <div className="flex flex-col gap-2">
          {confirming ? (
            <div
              role="alertdialog"
              aria-labelledby="override-title"
              className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3"
            >
              <p id="override-title" className="text-sm font-medium text-warning">
                Mark this cartridge ready anyway?
              </p>
              <p className="text-sm">
                It is below the bar on questions it had not seen. People may get a wrong rule, or a
                rule for a question it does not cover. The report will always say that you marked it
                ready.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setError(null);
                    onOverride().then(
                      () => setConfirming(false),
                      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                >
                  Mark ready anyway
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setConfirming(true)}
            >
              Mark ready anyway…
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
