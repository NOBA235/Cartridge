/**
 * Receipt counters: answers on this device, answers from the cloud, questions
 * that had to wait for signal, and questions that stayed unanswered. Bytes come
 * from the egress log. Counts are kept on this device (localStorage).
 */
import type { Answer } from '@/cartridge/answer';
import { createStore } from '@/lib/store';
import { egressLog, type EgressEntry } from './egress';

export interface Receipt {
  onDevice: number;
  cloud: number;
  queued: number;
  unanswered: number;
}

const KEY = 'cartridge.receipt.v1';
const ZERO: Receipt = { onDevice: 0, cloud: 0, queued: 0, unanswered: 0 };

function load(): Receipt {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return ZERO;
    const p = JSON.parse(raw) as Partial<Receipt>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
      onDevice: n(p.onDevice),
      cloud: n(p.cloud),
      queued: n(p.queued),
      unanswered: n(p.unanswered),
    };
  } catch {
    return ZERO;
  }
}

const store = createStore<Receipt>(load());

function save(r: Receipt): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage unavailable: counts still apply for this session.
  }
}

/** Which counter an answer adds to. */
export function counterFor(a: Pick<Answer, 'route' | 'status'>): keyof Receipt {
  if (a.status === 'queued') return 'queued';
  if (a.status === 'unanswered') return 'unanswered';
  return a.route === 'IN_CLOUD' ? 'cloud' : 'onDevice';
}

/** Bytes sent for questions (cloud answer calls), from the egress log. */
export function questionBytes(entries: readonly EgressEntry[]): number {
  return entries
    .filter((e) => e.kind === 'cloud-call' && e.label === 'ANSWER')
    .reduce((s, e) => s + e.bytesSent, 0);
}

export const receipt = {
  subscribe: store.subscribe,
  get: store.get,
  count(a: Pick<Answer, 'route' | 'status'>): void {
    const key = counterFor(a);
    store.set((r) => ({ ...r, [key]: r[key] + 1 }));
    save(store.get());
  },
  questionBytes: () => questionBytes(egressLog.entries()),
  reset(): void {
    store.set(ZERO);
    save(ZERO);
  },
};
