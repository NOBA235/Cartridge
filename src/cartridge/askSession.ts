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
import { askCloud, planCloudQuestion, type AskContext, type CloudAnswer } from './ask';
import { newProposalRecord } from './proposals';
import { ruleIndexFor } from './retrieve';
import type { SourceDoc } from './source';
import {
  cartridgesStore,
  proposalsStore,
  queueStore,
  sourcesStore,
  type CartridgeRecord,
} from './store';
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
  answer: CloudAnswer;
}

const history = createStore<readonly HistoryEntry[]>([]);
let nextId = 1;

/**
 * Saves a rule the cloud suggested (it already passed the checks) so it can be
 * reviewed on the Versions screen. Nothing is added to the cartridge here.
 */
export async function rememberProposal(
  answer: CloudAnswer,
  cartridgeId: string,
  cartridgeVersion: number,
): Promise<CloudAnswer> {
  if (!answer.proposal) return answer;
  const record = newProposalRecord(answer.proposal, {
    cartridgeId,
    baseVersion: cartridgeVersion,
    question: answer.question,
    answer: answer.decision ?? '',
  });
  try {
    await proposalsStore.put(record);
    return { ...answer, proposalId: record.id };
  } catch (e) {
    return {
      ...answer,
      proposalDiscarded: `The suggested rule could not be saved on this device: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const askHistory = {
  subscribe: history.subscribe,
  get: history.get,
  add(answer: CloudAnswer, cartridgeId: string): void {
    receipt.count(answer);
    history.set((h) => [{ id: `a${nextId++}`, cartridgeId, answer }, ...h]);
  },
  /** A queued question was answered: replace its 'Waiting for signal' entry. */
  resolveQueued(queueId: string, answer: CloudAnswer, cartridgeId: string): void {
    receipt.count(answer);
    history.set((h) =>
      h.some((e) => e.answer.queueId === queueId)
        ? h.map((e) => (e.answer.queueId === queueId ? { ...e, answer } : e))
        : [{ id: `a${nextId++}`, cartridgeId, answer }, ...h],
    );
  },
};

// ---------- offline queue ----------

async function sendQueued(item: QueueItem, question: Public<string>): Promise<CloudAnswer> {
  const ctx = await loadAskContext(item.cartridgeId, item.cartridgeVersion);
  if (!ctx) throw new Error('The cartridge for this question is no longer on this device.');
  const answer = await askCloud(
    question,
    planCloudQuestion(item.question, ctx),
    ctx,
    cloudJson,
    item.reason,
  );
  return rememberProposal(answer, item.cartridgeId, item.cartridgeVersion);
}

export const offlineQueue = createOfflineQueue<CloudAnswer>({
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
