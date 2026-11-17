/**
 * Exam Day: the cloud writes a test from the public rules, Gemini Nano takes it
 * on this device, a cloud tutor improves the weak rules, the device retakes
 * it, and a held-out set the tutor never saw checks the improvement is real.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { LoadedCartridge } from '@/cartridge/askSession';
import { examsStore } from '@/cartridge/store';
import type { Rule } from '@/cartridge/types';
import { examJobs, type ExamJob, type ExamPhase } from '@/exam/examJob';
import { usableExam } from '@/exam/generate';
import type { ExamSet, TutorChange } from '@/exam/types';
import { config } from '@/config';
import { DevicePanel, useDeviceState } from '@/ui/components/DevicePanel';
import { ExamReportCard } from '@/ui/components/ExamReportCard';
import { useConnectivity } from '@/ui/components/NoSignalSwitch';
import { RuleDots } from '@/ui/components/RuleDots';
import { ScoreRing } from '@/ui/components/ScoreRing';
import { useCartridges, useLoadedCartridge } from '@/ui/hooks/useCartridges';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, navigate, useLocation } from '@/ui/router';
import { inputClass } from '@/ui/styles';

function useJob(id: string): ExamJob | undefined {
  return useSyncExternalStore(examJobs.subscribe, () => examJobs.get()[id]);
}

const PHASE: Record<ExamPhase, string> = {
  loading: 'Getting ready…',
  writing: 'The cloud is writing the exam from the public rules…',
  practice: 'Practice questions, answered on this device',
  tutor: 'The tutor (cloud) is improving the rules the device got wrong…',
  'held-out': 'Held-out questions, answered once on this device',
  finishing: 'Writing the report card…',
};

const FIELD: Record<TutorChange['field'], string> = {
  title: 'Title',
  when: 'When',
  keywords: 'Keywords',
  notWhen: 'Not when',
};

function TutorChanges({ changes }: { changes: readonly TutorChange[] }) {
  if (changes.length === 0)
    return <p className="text-sm text-muted-foreground">The tutor changed nothing.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {changes.map((c, i) => (
        <li key={i} className={`rounded-lg border p-3 ${c.reverted ? 'opacity-60' : ''}`}>
          <p className="font-medium">
            <span className="mr-1 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">
              {c.ruleId}
            </span>
            {FIELD[c.field]}
            {c.reverted && (
              <span className="ml-2 text-xs text-warning">Undone: practice got worse</span>
            )}
          </p>
          <p className="text-muted-foreground line-through">{c.before || '(empty)'}</p>
          <p>{c.after}</p>
          {c.why && <p className="text-xs text-muted-foreground">Why: {c.why}</p>}
        </li>
      ))}
    </ul>
  );
}

function Running({
  job,
  rules,
}: {
  job: Extract<ExamJob, { status: 'running' }>;
  rules: readonly Rule[];
}) {
  const passed = job.results.filter((r) => r.pass).length;
  const answering = job.phase === 'practice' || job.phase === 'held-out';
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-4 rounded-xl border p-5">
      <p className="self-start text-sm font-medium">
        {PHASE[job.phase]}
        {job.phase === 'practice' && job.round > 0 && `, retake after tutor round ${job.round}`}
        {job.phase === 'tutor' && ` Round ${job.round}.`}
      </p>
      <ScoreRing
        passed={passed}
        total={job.results.length}
        caption={answering ? `Question ${job.results.length} of ${job.total}` : 'Waiting'}
      />
      <div className="self-stretch">
        <RuleDots rules={rules} results={job.results} />
      </div>
    </section>
  );
}

function Done({
  job,
  loaded,
}: {
  job: Extract<ExamJob, { status: 'done' }>;
  loaded: LoadedCartridge;
}) {
  const { result } = job;
  const final = [...result.practice, ...result.heldOut];
  const c = result.report.counts;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-around gap-6 rounded-xl border p-5">
        <ScoreRing
          passed={c?.practiceStart.passed ?? 0}
          total={c?.practiceStart.total ?? 0}
          caption="Practice, first try"
          size={136}
        />
        <ScoreRing
          passed={c?.practice.passed ?? 0}
          total={c?.practice.total ?? 0}
          caption="Practice, after the tutor"
          size={136}
        />
        <ScoreRing
          passed={c?.heldOut.passed ?? 0}
          total={c?.heldOut.total ?? 0}
          caption="Held-out, never seen by the tutor"
        />
      </section>
      <section className="rounded-xl border p-5">
        <h2 className="mb-2 text-sm font-semibold">Rules</h2>
        <RuleDots rules={result.rules} results={final} />
      </section>
      <section aria-labelledby="tutor-title" className="flex flex-col gap-2">
        <h2 id="tutor-title" className="text-lg font-semibold">
          What the tutor changed
        </h2>
        <p className="text-xs text-muted-foreground">
          Only titles, situations, keywords and not-when hints. The instruction, exceptions,
          severity, quote and calculation of a rule never change.
        </p>
        <TutorChanges changes={result.changes} />
      </section>
      <p className="text-sm text-muted-foreground" role="status">
        {job.newVersion
          ? `Saved as version ${job.savedVersion} with the tutor’s changes.`
          : `The report was saved on version ${job.savedVersion}.`}{' '}
        <a
          href={href('/cartridge', { id: loaded.cartridge.id })}
          onClick={linkHandler('/cartridge', { id: loaded.cartridge.id })}
          className="underline underline-offset-4"
        >
          Open the cards
        </a>
      </p>
    </div>
  );
}

function ExamFor({ loaded, onSaved }: { loaded: LoadedCartridge; onSaved: () => void }) {
  const id = loaded.cartridge.id;
  const newExamId = useId();
  const job = useJob(id);
  const device = useDeviceState(loaded.cartridge);
  const online = useConnectivity();
  const [saved, setSaved] = useState<ExamSet | undefined | null>(null);
  const [newExam, setNewExam] = useState(false);

  useEffect(() => {
    let live = true;
    examsStore.get(id).then(
      (e) => live && setSaved(e),
      () => live && setSaved(undefined),
    );
    return () => {
      live = false;
    };
  }, [id, job?.status]);

  // Refresh the loaded cartridge once a run has saved its result.
  const doneVersion = job?.status === 'done' ? job.savedVersion : undefined;
  useEffect(() => {
    if (doneVersion !== undefined) onSaved();
  }, [doneVersion, onSaved]);

  const reusable = saved
    ? usableExam(saved, loaded.cartridge, config.exam.minQuestions)
    : undefined;
  const needsCloud = newExam || !reusable;
  const cloudOk = online.browserOnline && !online.simulatedOffline;
  const blocked = !loaded.source
    ? 'The rulebook for this cartridge is not on this device, so answers cannot be checked. Load the same rulebook first.'
    : device.state !== 'ready'
      ? 'Prepare this device first: Exam Day measures Gemini Nano on this device.'
      : needsCloud && !cloudOk
        ? 'Writing the exam needs the cloud once, and there is no signal.'
        : null;
  const running = job?.status === 'running';

  return (
    <div className="flex flex-col gap-6">
      {!loaded.source && (
        <p
          role="status"
          className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
        >
          The rulebook for this cartridge is not on this device.
        </p>
      )}
      <DevicePanel cartridge={loaded.cartridge} />

      {!running && (
        <section className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="text-sm text-muted-foreground">
            The cloud writes about {config.exam.questionCount} questions from the public rules,
            including some that no rule answers. Gemini Nano answers them here; the cloud is not
            asked during the test. The tutor sees only the practice questions it got wrong. Every
            cloud call shows in &lsquo;What left this device&rsquo;.
          </p>
          {saved === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : reusable ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Saved exam: {reusable.items.length} questions (
                {reusable.items.filter((i) => i.split === 'practice').length} practice,{' '}
                {reusable.items.filter((i) => i.split === 'held-out').length} held-out), written{' '}
                {new Date(reusable.createdAt).toLocaleDateString()}. The same held-out questions are
                used again.
              </p>
              <label htmlFor={newExamId} className="flex items-center gap-2">
                <input
                  id={newExamId}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={newExam}
                  onChange={(e) => setNewExam(e.target.checked)}
                />
                Write a new exam instead (uses the cloud once)
              </label>
            </div>
          ) : (
            <p className="text-sm">No exam yet. The cloud writes one when you start.</p>
          )}
          <Button
            className="self-start"
            disabled={blocked !== null}
            onClick={() => examJobs.start(id, { newExam })}
          >
            {loaded.cartridge.report ? 'Run Exam Day again' : 'Start Exam Day'}
          </Button>
          {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
        </section>
      )}

      {job?.status === 'running' && (
        <>
          <Running job={job} rules={loaded.cartridge.rules} />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => examJobs.stop(id)}
          >
            Stop
          </Button>
        </>
      )}
      {job?.status === 'failed' && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Exam Day did not finish. {job.error}
        </p>
      )}
      {job?.status === 'stopped' && (
        <p className="text-sm text-muted-foreground">Stopped. No result was saved.</p>
      )}
      {job?.status === 'done' && <Done job={job} loaded={loaded} />}

      {loaded.cartridge.report && !running && (
        <ExamReportCard
          report={loaded.cartridge.report}
          rules={loaded.cartridge.rules}
          onOverride={async () => {
            await examJobs.override(id);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

export function ExamDay() {
  const { params } = useLocation();
  const selectId = useId();
  const [refresh, setRefresh] = useState(0);
  const { records, error } = useCartridges(refresh);
  const id = params.get('id') ?? records?.[0]?.id ?? null;
  const loaded = useLoadedCartridge(id, refresh);

  const header = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Exam Day</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Test the cartridge on this device before you rely on it.
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
          There is no cartridge on this device yet. Load a rulebook and make its cartridge first.
        </p>
        <a
          href="/load"
          onClick={linkHandler('/load')}
          className={buttonVariants({ className: 'self-start' })}
        >
          Load a rulebook
        </a>
      </section>
    );
  }

  const current =
    loaded !== null && loaded !== 'missing' && loaded.cartridge.id === id ? loaded : null;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-sm text-muted-foreground">
          Cartridge
        </label>
        <select
          id={selectId}
          className={`${inputClass} w-auto max-w-full`}
          value={id ?? ''}
          onChange={(e) => navigate('/exam', { id: e.target.value })}
        >
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} (v{r.currentVersion}, {r.ruleCount} rules)
            </option>
          ))}
        </select>
      </div>
      {loaded === 'missing' && (
        <p role="alert" className="text-sm">
          This cartridge is not on this device.
        </p>
      )}
      {current ? (
        <ExamFor
          key={current.cartridge.id}
          loaded={current}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      ) : (
        loaded !== 'missing' && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
