/**
 * Runs the check after a suggestion is approved, outside any one screen.
 * One job per suggestion. Uses Gemini Nano on this device, and the cloud only
 * to write test questions for the new rule (public rule text, when there is
 * signal). The result is saved on the suggestion.
 */
import { cloudJson } from '@/ai/cloud';
import { deviceSessions } from '@/ai/deviceSessions';
import { loadAskContext } from '@/cartridge/askSession';
import type { CheckSummary } from '@/cartridge/proposals';
import { examsStore, proposalsStore } from '@/cartridge/store';
import { createStore } from '@/lib/store';
import { connectivity } from '@/queue/connectivity';
import { runRuleCheck } from './check';

export type CheckJob =
  | { status: 'running'; done: number; total: number }
  | { status: 'needs-device'; reason: string }
  | { status: 'done'; summary: CheckSummary }
  | { status: 'failed'; error: string };

const jobs = createStore<Readonly<Record<string, CheckJob>>>({});

function set(id: string, job: CheckJob) {
  jobs.set((all) => ({ ...all, [id]: job }));
}

export const checkJobs = {
  subscribe: jobs.subscribe,
  get: jobs.get,

  start(proposalId: string): void {
    if (jobs.get()[proposalId]?.status === 'running') return;
    set(proposalId, { status: 'running', done: 0, total: 0 });

    const run = async () => {
      const record = await proposalsStore.get(proposalId);
      if (!record || record.status !== 'approved' || !record.approvedVersion || !record.ruleId) {
        throw new Error('This suggestion has not been approved.');
      }
      const ctx = await loadAskContext(record.cartridgeId, record.approvedVersion);
      if (!ctx) throw new Error(`Version ${record.approvedVersion} is no longer on this device.`);
      if (!ctx.source)
        throw new Error('The rulebook is not on this device, so answers cannot be checked.');

      const state = await deviceSessions.prepare();
      const device = deviceSessions.handle();
      if (state.state !== 'ready' || !device?.ready) {
        set(proposalId, {
          status: 'needs-device',
          reason:
            state.state === 'unavailable'
              ? state.reason
              : 'Gemini Nano is not ready on this device.',
        });
        return;
      }

      // Rule text that carries words from the user's question is not sent to the cloud again.
      const sendRule = connectivity.online() && record.questionWords.length === 0;
      const summary = await runRuleCheck({
        after: ctx.cartridge,
        changedIds: [record.ruleId],
        exam: await examsStore.get(record.cartridgeId).catch(() => undefined),
        source: ctx.source,
        device,
        ...(sendRule ? { cloud: cloudJson } : {}),
        userQuestion: { text: record.question, expectedRuleId: record.ruleId },
        onExamUpdated: (exam) => examsStore.put(exam).catch(() => undefined),
        onProgress: (done, total) => set(proposalId, { status: 'running', done, total }),
      });
      if (record.questionWords.length > 0) {
        summary.notes.unshift(
          'No questions were written by the cloud: this rule contains words from your question that are not in the rulebook.',
        );
      }
      await proposalsStore.put({ ...record, check: summary });
      set(proposalId, { status: 'done', summary });
    };

    run().catch((e: unknown) =>
      set(proposalId, { status: 'failed', error: e instanceof Error ? e.message : String(e) }),
    );
  },
};
