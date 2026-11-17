/**
 * Runs 'Make the cartridge' outside any one screen, so progress survives
 * navigating away. One job per source. The finished cartridge is saved to
 * IndexedDB before the job reports 'done'; if saving fails, the job keeps it
 * so it can be saved again or exported.
 */
import { cloudJson } from '@/ai/cloud';
import { storageErrorMessage } from '@/lib/storageErrors';
import { createStore } from '@/lib/store';
import {
  compileCartridge,
  CompileError,
  type CompileNote,
  type CompileResult,
  type CompileStats,
  type DroppedRule,
  type SectionFailure,
} from './compile';
import { activeCartridge } from './active';
import type { SourceDoc } from './source';
import { cartridgesStore } from './store';

export type CompileJob =
  | {
      status: 'running';
      section: number;
      sectionCount: number;
      verified: number;
      checked: number;
      repairing: boolean;
      finishing: boolean;
    }
  | {
      status: 'done';
      cartridgeId: string;
      kept: number;
      dropped: DroppedRule[];
      notes: CompileNote[];
      failedSections: SectionFailure[];
      stats: CompileStats;
    }
  | {
      status: 'failed';
      error: string;
      dropped: DroppedRule[];
      failedSections: SectionFailure[];
      /** Made but not saved (storage full or blocked): kept here to save again or export. */
      unsaved?: CompileResult;
    }
  | { status: 'stopped' };

const jobs = createStore<Readonly<Record<string, CompileJob>>>({});
const controllers = new Map<string, AbortController>();

function update(
  sourceId: string,
  next: CompileJob | ((prev: CompileJob | undefined) => CompileJob),
) {
  jobs.set((all) => ({
    ...all,
    [sourceId]: typeof next === 'function' ? next(all[sourceId]) : next,
  }));
}

function patchRunning(
  sourceId: string,
  patch: Partial<Extract<CompileJob, { status: 'running' }>>,
) {
  update(sourceId, (prev) =>
    prev?.status === 'running' ? { ...prev, ...patch } : (prev as CompileJob),
  );
}

/** Saves a finished cartridge. If storage fails, the result is kept so nothing made is lost. */
async function save(sourceId: string, res: CompileResult): Promise<void> {
  try {
    await cartridgesStore.saveVersion(res.cartridge, sourceId);
  } catch (e) {
    update(sourceId, {
      status: 'failed',
      error: storageErrorMessage(e, 'the cartridge'),
      dropped: res.dropped,
      failedSections: res.failedSections,
      unsaved: res,
    });
    return;
  }
  activeCartridge.set(res.cartridge.id);
  update(sourceId, {
    status: 'done',
    cartridgeId: res.cartridge.id,
    kept: res.cartridge.rules.length,
    dropped: res.dropped,
    notes: res.notes,
    failedSections: res.failedSections,
    stats: res.stats,
  });
}

export const compileJobs = {
  subscribe: jobs.subscribe,
  get: jobs.get,

  /** Tries again to save a cartridge that was made but could not be saved. */
  saveAgain(sourceId: string): Promise<void> {
    const job = jobs.get()[sourceId];
    if (job?.status !== 'failed' || !job.unsaved) return Promise.resolve();
    return save(sourceId, job.unsaved);
  },

  start(source: SourceDoc): void {
    if (jobs.get()[source.id]?.status === 'running') return;
    const ctrl = new AbortController();
    controllers.set(source.id, ctrl);
    update(source.id, {
      status: 'running',
      section: 0,
      sectionCount: 0,
      verified: 0,
      checked: 0,
      repairing: false,
      finishing: false,
    });

    void compileCartridge(source, {
      cloud: cloudJson,
      signal: ctrl.signal,
      onProgress: (p) => {
        if (p.step === 'reading') {
          patchRunning(source.id, {
            section: p.section,
            sectionCount: p.sectionCount,
            repairing: false,
          });
        } else if (p.step === 'checking') {
          patchRunning(source.id, { verified: p.verified, checked: p.checked, repairing: false });
        } else if (p.step === 'repairing') {
          patchRunning(source.id, { repairing: true });
        } else {
          patchRunning(source.id, { finishing: true });
        }
      },
    })
      .then((res) => save(source.id, res))
      .catch((e: unknown) => {
        if (e instanceof CompileError && e.code === 'STOPPED') {
          update(source.id, { status: 'stopped' });
          return;
        }
        update(source.id, {
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
          dropped: e instanceof CompileError ? (e.partial?.dropped ?? []) : [],
          failedSections: e instanceof CompileError ? (e.partial?.failedSections ?? []) : [],
        });
      })
      .finally(() => controllers.delete(source.id));
  },

  stop(sourceId: string): void {
    controllers.get(sourceId)?.abort();
  },

  clear(sourceId: string): void {
    if (jobs.get()[sourceId]?.status === 'running') return;
    jobs.set((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== sourceId)));
  },
};
