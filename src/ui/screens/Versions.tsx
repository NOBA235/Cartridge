/**
 * Versions and suggestions for one cartridge.
 * - Suggested rules: what would change, the evidence in the rulebook, the
 *   tests the change may affect; approve (version N+1) or reject. After
 *   approval, the check on this device and its result.
 * - Version history: every version with what changed; restore makes a new
 *   version with the old rules, so nothing is ever lost.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadAskContext, type LoadedCartridge } from '@/cartridge/askSession';
import {
  checkProposal,
  ruleFromDraft,
  type CheckSummary,
  type ProposalRecord,
} from '@/cartridge/proposals';
import { cartridgesStore, examsStore, proposalsStore } from '@/cartridge/store';
import type { Cartridge } from '@/cartridge/types';
import { approveSuggestion, rejectSuggestion, restoreToVersion } from '@/cartridge/versionActions';
import { diffRules, nextRuleId } from '@/cartridge/versions';
import { config } from '@/config';
import { selectCheckItems, type CheckGroup } from '@/exam/check';
import { checkJobs, type CheckJob } from '@/exam/checkJob';
import type { ExamSet } from '@/exam/types';
import { DiffView } from '@/ui/components/DiffView';
import { ReadyBadge } from '@/ui/components/ExamReportCard';
import { useConnectivity } from '@/ui/components/NoSignalSwitch';
import { SourceContext } from '@/ui/components/SourceContext';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, useLocation } from '@/ui/router';

interface Data {
  loaded: LoadedCartridge;
  /** Oldest first. */
  versions: Cartridge[];
  proposals: ProposalRecord[];
  exam?: ExamSet;
}

async function loadData(id: string): Promise<Data | 'missing'> {
  const loaded = await loadAskContext(id);
  if (!loaded) return 'missing';
  const [versions, proposals, exam] = await Promise.all([
    cartridgesStore.versions(id),
    proposalsStore.list(id),
    examsStore.get(id).catch(() => undefined),
  ]);
  return { loaded, versions, proposals, ...(exam ? { exam } : {}) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const GROUP_LABEL: Record<CheckGroup, string> = {
  'new-rule': 'Questions for the new rule',
  'your-question': 'Your question',
  affected: 'Questions the new rule may affect',
  regression: 'Other exam questions (regression)',
};

function ruleLabel(id: string, c: Cartridge): string {
  if (id === 'NONE') return 'no rule (not covered)';
  if (id === 'ERROR') return 'no answer (device error)';
  const r = c.rules.find((x) => x.id === id);
  return r ? `${id} ${r.title}` : id;
}

function useCheckJob(id: string): CheckJob | undefined {
  return useSyncExternalStore(checkJobs.subscribe, () => checkJobs.get()[id]);
}

function CheckResult({ record, cartridge }: { record: ProposalRecord; cartridge: Cartridge }) {
  const job = useCheckJob(record.id);
  if (job?.status === 'running') {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Checking on this device
        {job.total > 0
          ? `: question ${job.done} of ${job.total}`
          : ': writing test questions for the new rule…'}
      </p>
    );
  }
  if (job?.status === 'needs-device') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-warning">The check needs Gemini Nano on this device. {job.reason}</p>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => checkJobs.start(record.id)}
        >
          Prepare this device and check
        </Button>
      </div>
    );
  }
  if (job?.status === 'failed') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p role="alert" className="text-destructive">
          The check did not finish. {job.error}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => checkJobs.start(record.id)}
        >
          Try the check again
        </Button>
      </div>
    );
  }
  const summary: CheckSummary | undefined = job?.status === 'done' ? job.summary : record.check;
  if (!summary) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => checkJobs.start(record.id)}
      >
        Check it on this device
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">
        Checked on{' '}
        {summary.measuredOn === 'device'
          ? 'this device (Gemini Nano)'
          : 'a stand-in, not measured on a real device'}
        , version {summary.version}:
      </p>
      <ul className="flex flex-col gap-1">
        {summary.groups.map((g) => (
          <li key={g.group} className="flex justify-between gap-4 border-b pb-1 last:border-b-0">
            <span>{GROUP_LABEL[g.group]}</span>
            <span className={g.passed === g.total ? 'text-success' : 'text-warning'}>
              {g.passed} of {g.total} passed
            </span>
          </li>
        ))}
      </ul>
      {summary.maybeCovered.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-2">
          <p className="text-warning">
            These exam questions were written as not covered, and the device now answers them with
            the new rule. The new rule may really cover them. Choose &lsquo;Write a new exam&rsquo;
            on Exam Day to test this cartridge fairly.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {summary.maybeCovered.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.failures.length > 0 && (
        <details>
          <summary className="cursor-pointer">Failed questions ({summary.failures.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.failures.map((f, i) => (
              <li key={i} className="rounded-md border p-2">
                {f.question}
                <span className="block text-xs text-muted-foreground">
                  Expected {ruleLabel(f.expected, cartridge)}; the device chose{' '}
                  {ruleLabel(f.predicted, cartridge)}.
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {summary.notes.map((n, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {n}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        This is a quick check, not a full exam. Run Exam Day for a report card.
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => checkJobs.start(record.id)}
      >
        Run the check again
      </Button>
    </div>
  );
}

function ProposalReview({
  record,
  data,
  onChanged,
}: {
  record: ProposalRecord;
  data: Data;
  onChanged: () => void;
}) {
  const current = data.loaded.cartridge;
  const online = useConnectivity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useMemo(() => {
    const check = checkProposal(record.draft, {
      rules: current.rules,
      source: data.loaded.source,
      ...(data.loaded.prepared ? { prepared: data.loaded.prepared } : {}),
      question: record.question,
    });
    if (!check?.ok)
      return { ok: false as const, detail: check?.detail ?? 'There is no suggested rule.' };
    const id = nextRuleId(data.versions.flatMap((v) => v.rules.map((r) => r.id)));
    const rule = ruleFromDraft(id, check.proposal.draft);
    const proposed: Cartridge = {
      ...current,
      version: current.version + 1,
      rules: [...current.rules, rule],
    };
    const affected = selectCheckItems({
      after: proposed,
      changedIds: [id],
      exam: data.exam,
      regressionSize: 0,
    }).filter((i) => i.group === 'affected');
    return {
      ok: true as const,
      proposal: check.proposal,
      rule,
      diff: diffRules(current.rules, proposed.rules),
      affected,
      similar: check.proposal.similarTo
        ? current.rules.find((r) => r.id === check.proposal.similarTo)
        : undefined,
    };
  }, [record, current, data]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(async () => {
      await approveSuggestion(record.id);
      checkJobs.start(record.id);
    });
  const reject = () => act(() => rejectSuggestion(record.id));

  return (
    <article
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={`Suggested rule: ${record.draft.title}`}
    >
      <header>
        <p className="text-xs text-muted-foreground">
          Suggested by the cloud on {new Date(record.createdAt).toLocaleString()}, when you asked:
        </p>
        <p className="text-sm">&ldquo;{record.question}&rdquo;</p>
        {record.answer && (
          <p className="mt-1 text-xs text-muted-foreground">Cloud answer: {record.answer}</p>
        )}
      </header>

      {!review.ok ? (
        <p role="alert" className="text-sm text-warning">
          This rule can no longer be added: {review.detail}
        </p>
      ) : (
        <>
          {record.baseVersion !== current.version && (
            <p className="text-xs text-muted-foreground">
              Suggested for version {record.baseVersion}. It would be added to the current version,{' '}
              {current.version}.
            </p>
          )}
          {record.questionWords.length > 0 && (
            <p
              role="status"
              className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
            >
              This rule contains words from your question that are not in the rulebook:{' '}
              {record.questionWords.map((w) => `‘${w}’`).join(', ')}. Rules are sent to the cloud
              when an exam is written. If any of these words are private, reject this rule.
            </p>
          )}
          {review.similar && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Very similar to {review.similar.id} &lsquo;{review.similar.title}&rsquo;. Compare
                before approving:
              </p>
              <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Existing</dt>
                <dd>{review.similar.then}</dd>
                <dt className="text-muted-foreground">Suggested</dt>
                <dd>{review.rule.then}</dd>
              </dl>
            </div>
          )}

          <section aria-label="What would change">
            <h3 className="mb-2 text-sm font-semibold">
              What would change: version {current.version} → {current.version + 1}
            </h3>
            <DiffView diff={review.diff} />
          </section>

          <section aria-label="Evidence">
            <h3 className="mb-1 text-sm font-semibold">Evidence</h3>
            <p className="mb-2 text-sm font-medium text-success">
              Verified against the source
              {review.proposal.page !== undefined && `, page ${review.proposal.page}`}
            </p>
            {data.loaded.source && (
              <SourceContext
                text={data.loaded.source.text}
                start={review.proposal.start}
                end={review.proposal.end}
              />
            )}
          </section>

          <section aria-label="Tests affected">
            <h3 className="mb-1 text-sm font-semibold">Tests affected</h3>
            {!data.exam ? (
              <p className="text-sm text-muted-foreground">
                No exam is saved for this cartridge yet. After approval, your question is checked on
                this device. Run Exam Day for a full test.
              </p>
            ) : review.affected.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved exam question would see the new rule.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {review.affected.map((i) => (
                  <li key={i.id} className="rounded-md border p-2">
                    {i.question}
                    <span className="block text-xs text-muted-foreground">
                      {i.expectedRuleId === 'NONE'
                        ? 'Written as not covered. The new rule may cover it.'
                        : `Expects ${ruleLabel(i.expectedRuleId, current)}. The new rule becomes a candidate.`}
                      {i.split === 'held-out' && ' Held-out question.'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {review.proposal.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {n}
            </p>
          ))}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void approve()}>
                Approve: add {review.rule.id} as version {current.version + 1}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void reject()}>
                Reject
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After approval this device answers your question and the exam questions the rule may
              affect, plus {config.versions.regressionQuestions} others.{' '}
              {online.browserOnline && !online.simulatedOffline && record.questionWords.length === 0
                ? `First the cloud writes ${config.versions.questionsPerNewRule} test questions for the new rule from its public text; the call shows in ‘What left this device’.`
                : 'No questions are written by the cloud for it now.'}
            </p>
          </div>
        </>
      )}
      {!review.ok && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => void reject()}
        >
          Reject
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

function changelogFor(v: Cartridge): string {
  return v.changelog.find((l) => l.startsWith(`Version ${v.version}:`)) ?? v.changelog.at(-1) ?? '';
}

function VersionItem({
  v,
  prev,
  isCurrent,
  onRestore,
}: {
  v: Cartridge;
  prev?: Cartridge;
  isCurrent: boolean;
  onRestore: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = useMemo(() => (prev ? diffRules(prev.rules, v.rules) : undefined), [prev, v]);
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Version {v.version}
          {isCurrent && (
            <span className="ml-2 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
              Current
            </span>
          )}
        </p>
        <span className="text-xs text-muted-foreground">
          {new Date(v.createdAt).toLocaleString()}, {v.rules.length} rules
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{changelogFor(v)}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {v.report ? (
          <>
            <ReadyBadge report={v.report} />
            <span className="text-muted-foreground">
              {v.report.measuredOn === 'device'
                ? 'Tested on this device'
                : 'Not measured on a real device'}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Not tested on this device</span>
        )}
      </div>
      {diff && (
        <details>
          <summary className="cursor-pointer text-sm">
            What changed from version {prev?.version}
          </summary>
          <div className="mt-2">
            <DiffView diff={diff} />
          </div>
        </details>
      )}
      {!isCurrent &&
        (confirming ? (
          <div
            role="alertdialog"
            aria-label={`Restore version ${v.version}`}
            className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
          >
            <p>
              Restore version {v.version}? This makes a new version with its {v.rules.length} rules.
              Nothing is deleted; you can restore the current version again later.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  onRestore().then(
                    () => setConfirming(false),
                    (e: unknown) => setError(message(e)),
                  );
                }}
              >
                Restore version {v.version}
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
            Restore this version…
          </Button>
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function Versions() {
  const { params } = useLocation();
  const id = params.get('id') ?? '';
  const [data, setData] = useState<Data | 'missing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  // Reload when a check finishes, so its saved result shows after navigation too.
  const jobs = useSyncExternalStore(checkJobs.subscribe, checkJobs.get);
  const doneChecks = Object.values(jobs).filter((j) => j.status === 'done').length;

  useEffect(() => {
    let live = true;
    loadData(id).then(
      (d) => live && setData(d),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [id, refresh, doneChecks]);

  if (error) {
    return (
      <section className="mx-auto max-w-3xl py-10">
        <p role="alert" className="text-sm text-destructive">
          Versions are not available: {error}
        </p>
      </section>
    );
  }
  if (data === null) return <p className="py-10 text-sm text-muted-foreground">Loading…</p>;
  if (data === 'missing') {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
        <p role="alert" className="text-sm">
          This cartridge is not on this device.
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

  const current = data.loaded.cartridge;
  const pending = data.proposals.filter((p) => p.status === 'pending');
  const decided = data.proposals.filter((p) => p.status !== 'pending');
  const newestFirst = [...data.versions].reverse();

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 py-10">
      <header className="flex flex-col gap-2">
        <a
          href={href('/cartridge', { id: current.id })}
          onClick={linkHandler('/cartridge', { id: current.id })}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← The cards
        </a>
        <h1 className="text-2xl font-semibold tracking-tight break-all">
          Versions and suggestions
        </h1>
        <p className="text-sm text-muted-foreground">
          {current.name}: version {current.version}, {current.rules.length} rules.
        </p>
        {!data.loaded.source && (
          <p
            role="status"
            className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
          >
            The rulebook for this cartridge is not on this device, so no suggestion can be checked
            or approved.
          </p>
        )}
      </header>

      <section aria-labelledby="suggestions-title" className="flex flex-col gap-3">
        <h2 id="suggestions-title" className="text-lg font-semibold">
          Suggested rules ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suggestion is waiting. When the cloud answers a question your cartridge missed, it
            may suggest a rule; it shows here for you to review.
          </p>
        ) : (
          pending.map((p) => (
            <ProposalReview key={p.id} record={p} data={data} onChanged={reload} />
          ))
        )}
        {decided.length > 0 && (
          <details open>
            <summary className="cursor-pointer text-sm font-medium">
              Decided ({decided.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {decided.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                  <p>
                    <span className="font-medium">{p.draft.title}</span>{' '}
                    <span className="text-muted-foreground">
                      {p.status === 'approved'
                        ? `added as ${p.ruleId ?? '?'} in version ${p.approvedVersion ?? '?'}`
                        : 'rejected'}
                      {p.decidedAt && ` on ${new Date(p.decidedAt).toLocaleString()}`}.
                    </span>
                  </p>
                  {p.status === 'approved' && <CheckResult record={p} cartridge={current} />}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2 id="history-title" className="text-lg font-semibold">
          Version history
        </h2>
        <ul className="flex flex-col gap-2">
          {newestFirst.map((v) => (
            <VersionItem
              key={v.version}
              v={v}
              prev={data.versions.find((x) => x.version === (v.parentVersion ?? v.version - 1))}
              isCurrent={v.version === current.version}
              onRestore={async () => {
                await restoreToVersion(current.id, v.version);
                reload();
              }}
            />
          ))}
        </ul>
      </section>
    </section>
  );
}
