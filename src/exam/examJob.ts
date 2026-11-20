/**
 * Runs Exam Day outside any one screen, so progress survives navigation.
 * One job per cartridge. Uses the real cloud and Gemini Nano on this device.
 * Saves the exam as soon as it is written, and the result when it finishes.
 */
import { cloudJson } from '@/ai/cloud';
import { deviceSessions } from '@/ai/deviceSessions';
import { loadAskContext } from '@/cartridge/askSession';
import { cartridgesStore, examsStore } from '@/cartridge/store';
import { storageErrorMessage } from '@/lib/storageErrors';
import { createStore } from '@/lib/store';
import { runExamDay, type ExamDayResult } from './examDay';
import { cartridgeAfterExam, overrideReady } from './save';
import type { ExamResult } from './types';

export type ExamPhase = 'loading' | 'writing' | 'practice' | 'tutor' | 'held-out' | 'finishing';

export type ExamJob =
  | { status: 'running'; phase: ExamPhase; round: number; results: ExamResult[]; total: number }
  | { status: 'done'; result: ExamDayResult; savedVersion: number; newVersion: boolean }
  | { status: 'failed'; error: string }
  | { status: 'stopped' };

const jobs = createStore<Readonly<Record<string, ExamJob>>>({});
const controllers = new Map<string, AbortController>();

function set(id: string, job: ExamJob) {
  jobs.set((all) => ({ ...all, [id]: job }));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const examJobs = {
  subscribe: jobs.subscribe,
  get: jobs.get,

  start(cartridgeId: string, options: { newExam?: boolean } = {}): void {
    if (jobs.get()[cartridgeId]?.status === 'running') return;
    const ctrl = new AbortController();
    controllers.set(cartridgeId, ctrl);
    set(cartridgeId, { status: 'running', phase: 'loading', round: 0, results: [], total: 0 });

    const run = async () => {
      const ctx = await loadAskContext(cartridgeId);
      if (!ctx) throw new Error('This cartridge is no longer on this device.');
      const device = deviceSessions.handle();
      if (!device?.ready)
        throw new Error('Gemini Nano is not ready on this device. Prepare this device first.');
      const saved = options.newExam
        ? undefined
        : await examsStore.get(cartridgeId).catch(() => undefined);
      const result = await runExamDay(ctx.cartridge, {
        cloud: cloudJson,
        device,
        source: ctx.source,
        ...(saved ? { exam: saved } : {}),
        onExamWritten: (exam) => examsStore.put(exam).catch(() => undefined),
        signal: ctrl.signal,
        onProgress: (p) => {
          if (p.step === 'writing')
            set(cartridgeId, {
              status: 'running',
              phase: 'writing',
              round: 0,
              results: [],
              total: 0,
            });
          else if (p.step === 'tutoring')
            set(cartridgeId, {
              status: 'running',
              phase: 'tutor',
              round: p.round,
              results: [],
              total: 0,
            });
          else if (p.step === 'finishing')
            set(cartridgeId, {
              status: 'running',
              phase: 'finishing',
              round: 0,
              results: [],
              total: 0,
            });
          else
            set(cartridgeId, {
              status: 'running',
              phase: p.set === 'practice' ? 'practice' : 'held-out',
              round: p.round,
              results: p.results,
              total: p.total,
            });
        },
      });
      const { cartridge, newVersion } = cartridgeAfterExam(ctx.cartridge, result);
      try {
        await cartridgesStore.saveVersion(cartridge, ctx.record.sourceId);
      } catch (e) {
        throw new Error(storageErrorMessage(e, 'the Exam Day result'), { cause: e });
      }
      set(cartridgeId, { status: 'done', result, savedVersion: cartridge.version, newVersion });
    };

    run()
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === 'STOPPED') set(cartridgeId, { status: 'stopped' });
        else set(cartridgeId, { status: 'failed', error: message(e) });
      })
      .finally(() => controllers.delete(cartridgeId));
  },

  stop(cartridgeId: string): void {
    controllers.get(cartridgeId)?.abort();
  },

  /** Marks the current version ready although it is below the bar. */
  async override(cartridgeId: string): Promise<void> {
    const cur = await cartridgesStore.current(cartridgeId);
    if (!cur) throw new Error('This cartridge is no longer on this device.');
    await cartridgesStore.saveVersion(overrideReady(cur.cartridge), cur.record.sourceId);
  },
};
