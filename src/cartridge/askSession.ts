/**
 * App wiring for the Ask screen: loads a cartridge with its rulebook, keeps
 * this session's answers, runs the offline queue with real storage, the real
 * signal probe and the real cloud, and counts the receipt.
 */
import { cloudJson } from '@/ai/cloud';
import { createStore } from '@/lib/store';
import type { Public } from '@/privacy';
import { connectivity } from '@/queue/connectivity';
import { createOfflineQueue, type QueueItem } from '@/queue/offlineQueue';
import { receipt } from '@/telemetry/receipt';
import type { Answer } from './answer';
import { askCloud, planCloudQuestion, type AskContext } from './ask';
import { ruleIndexFor } from './retrieve';
import type { SourceDoc } from './source';
import { cartridgesStore, queueStore, sourcesStore, type CartridgeRecord } from './store';
import type { Cartridge } from './types';
import { prepareSource } from './verifyQuote';

export interface LoadedCartridge extends AskContext {
  record: CartridgeRecord;
  source?: SourceDoc;
}

/** The cartridge's current version and, if it is on this device, its rulebook (matched by hash). */
export async function loadAskContext(
  cartridgeId: string,
  version?: number,
): Promise<LoadedCartridge | undefined> {
  const cur = await cartridgesStore.current(cartridgeId);
  if (!cur) return undefined;
  let cartridge: Cartridge | undefined = cur.cartridge;
  if (version !== undefined && version !== cur.cartridge.version) {
    cartridge = await cartridgesStore.version(cartridgeId, version);
    if (!cartridge) return undefined;
  }
  let source: SourceDoc | undefined = cur.record.sourceId
    ? await sourcesStore.get(cur.record.sourceId)
    : undefined;
  if (!source || source.hash !== cartridge.sourceHash) {
    source = (await sourcesStore.list()).find((s) => s.hash === cartridge.sourceHash);
  }
  return {
    record: cur.record,
    cartridge,
    index: ruleIndexFor(cartridge),
    ...(source ? { source, prepared: prepareSource(source) } : {}),
  };
}

// ---------- this session's answers ----------

export interface HistoryEntry {
  id: string;
  cartridgeId: string;
  answer: Answer;
}

const history = createStore<readonly HistoryEntry[]>([]);
let nextId = 1;

export const askHistory = {
  subscribe: history.subscribe,
  get: history.get,
  add(answer: Answer, cartridgeId: string): void {
    receipt.count(answer);
    history.set((h) => [{ id: `a${nextId++}`, cartridgeId, answer }, ...h]);
  },
  /** A queued question was answered: replace its 'Waiting for signal' entry. */
  resolveQueued(queueId: string, answer: Answer, cartridgeId: string): void {
    receipt.count(answer);
    history.set((h) =>
      h.some((e) => e.answer.queueId === queueId)
        ? h.map((e) => (e.answer.queueId === queueId ? { ...e, answer } : e))
        : [{ id: `a${nextId++}`, cartridgeId, answer }, ...h],
    );
  },
};

// ---------- offline queue ----------

async function sendQueued(item: QueueItem, question: Public<string>): Promise<Answer> {
  const ctx = await loadAskContext(item.cartridgeId, item.cartridgeVersion);
  if (!ctx) throw new Error('The cartridge for this question is no longer on this device.');
  return askCloud(question, planCloudQuestion(item.question, ctx), ctx, cloudJson, item.reason);
}

export const offlineQueue = createOfflineQueue<Answer>({
  storage: queueStore,
  probe: () => connectivity.probe(),
  online: () => connectivity.online(),
  send: sendQueued,
  onAnswer: (answer, item) => askHistory.resolveQueued(item.id, answer, item.cartridgeId),
});

let started = false;

/** Loads waiting questions and sends them whenever signal comes back. */
export function startAskSession(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void offlineQueue.load().catch(() => undefined);
  let wasOnline = connectivity.online();
  connectivity.subscribe(() => {
    const isOnline = connectivity.online();
    if (isOnline && !wasOnline) void offlineQueue.drain();
    wasOnline = isOnline;
  });
}
