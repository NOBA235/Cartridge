/**
 * Drafts and runs the connection test outside any one screen, so progress
 * survives navigation. One job per cartridge. Drafting uses the cloud once
 * (public rules only); running uses Gemini Nano on this device only. The
 * result is saved on the cartridge version that was tested.
 */
import { cloudJson } from '@/ai/cloud';
import { createEdgeModel } from '@/ai/device';
import { deviceSessions } from '@/ai/deviceSessions';
import { loadAskContext } from '@/cartridge/askSession';
import { benchesStore, cartridgesStore } from '@/cartridge/store';
import { CartridgeSchema } from '@/cartridge/types';
import { storageErrorMessage } from '@/lib/storageErrors';
import { createStore } from '@/lib/store';
import { draftBench, runBench, type BenchItemResult } from './bench';
import type { EdgeBenchReport } from './benchTypes';

export type BenchJob =
  | { status: 'drafting' }
  | { status: 'drafted'; dropped: number }
  | { status: 'running'; run: number; runs: number; item: number; items: number }
  | { status: 'done'; report: EdgeBenchReport; results: BenchItemResult[]; version: number }
  | { status: 'failed'; error: string }
  | { status: 'stopped' };

const jobs = createStore<Readonly<Record<string, BenchJob>>>({});
const controllers = new Map<string, AbortController>();

function set(id: string, job: BenchJob) {
  jobs.set((all) => ({ ...all, [id]: job }));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const busy = (id: string) => {
  const s = jobs.get()[id]?.status;
  return s === 'drafting' || s === 'running';
};

export const benchJobs = {
  subscribe: jobs.subscribe,
  get: jobs.get,

  draft(cartridgeId: string): void {
    if (busy(cartridgeId)) return;
    set(cartridgeId, { status: 'drafting' });
    (async () => {
      const ctx = await loadAskContext(cartridgeId);
      if (!ctx) throw new Error('This cartridge is no longer on this device.');
      const { bench, dropped } = await draftBench(ctx.cartridge, { cloud: cloudJson });
      try {
        await benchesStore.put(bench);
      } catch (e) {
        throw new Error(storageErrorMessage(e, 'the connections'), { cause: e });
      }
      set(cartridgeId, { status: 'drafted', dropped });
    })().catch((e: unknown) => set(cartridgeId, { status: 'failed', error: message(e) }));
  },

  run(cartridgeId: string): void {
    if (busy(cartridgeId)) return;
    const ctrl = new AbortController();
    controllers.set(cartridgeId, ctrl);
    set(cartridgeId, { status: 'running', run: 0, runs: 0, item: 0, items: 0 });
    (async () => {
      const ctx = await loadAskContext(cartridgeId);
      if (!ctx) throw new Error('This cartridge is no longer on this device.');
      const bench = await benchesStore.get(cartridgeId);
      if (!bench) throw new Error('There are no connections to test yet.');
      if (!deviceSessions.handle(ctx.cartridge)?.ready) {
        throw new Error('Gemini Nano is not ready on this device. Prepare this device first.');
      }
      const model = createEdgeModel(ctx.cartridge.rules.map((r) => r.id));
      const status = await model.prepare(() => {});
      if (status.state !== 'ready')
        throw new Error(`Gemini Nano is not available: ${status.reason}`);
      const { report, results } = await runBench(bench, ctx, model, {
        signal: ctrl.signal,
        onProgress: (p) => set(cartridgeId, { status: 'running', ...p }),
      });
      // Save on the version that was tested, only if it is still the current one.
      const cur = await cartridgesStore.current(cartridgeId);
      if (!cur || cur.cartridge.version !== ctx.cartridge.version) {
        throw new Error(
          'A new version was saved while the test ran, so this result was not kept. Run it again.',
        );
      }
      try {
        await cartridgesStore.saveVersion(
          CartridgeSchema.parse({ ...cur.cartridge, edgeBench: report }),
          cur.record.sourceId,
        );
      } catch (e) {
        throw new Error(storageErrorMessage(e, 'the test result'), { cause: e });
      }
      set(cartridgeId, { status: 'done', report, results, version: ctx.cartridge.version });
    })()
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === 'STOPPED') set(cartridgeId, { status: 'stopped' });
        else set(cartridgeId, { status: 'failed', error: message(e) });
      })
      .finally(() => controllers.delete(cartridgeId));
  },

  stop(cartridgeId: string): void {
    controllers.get(cartridgeId)?.abort();
  },
};
