/**
 * Questions waiting for signal ('Waiting for signal').
 *
 * - Items are persisted (IndexedDB queue store), so they survive a reload.
 * - The user's approval to send a question lives in memory only. After a
 *   reload, an item needs a fresh approval before it is sent: approvals are
 *   never re-created from storage.
 * - drain() runs on the browser's 'online' event, when 'Simulated no signal'
 *   is switched off, and at start. It first makes a real probe, then sends the
 *   approved items one by one. Items that fail stay in the queue.
 */
import { CloudError } from '@/ai/cloud';
import type { EscalationReason } from '@/ai/router';
import { createStore } from '@/lib/store';
import type { Public } from '@/privacy';

export interface QueueItem {
  id: string;
  createdAt: string;
  /** The user's question, stored on this device only. */
  question: string;
  reason: EscalationReason;
  cartridgeId: string;
  cartridgeVersion: number;
  attempts: number;
  lastError?: string;
}

export interface QueueView extends QueueItem {
  /** True when the approval was lost (for example after a reload). */
  needsApproval: boolean;
  sending: boolean;
}

export interface QueueStorage {
  all(): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface QueueDeps<R> {
  storage: QueueStorage;
  /** Real connectivity check. */
  probe: () => Promise<boolean>;
  online: () => boolean;
  send: (item: QueueItem, question: Public<string>) => Promise<R>;
  onAnswer?: (result: R, item: QueueItem) => void;
  now?: () => Date;
  newId?: () => string;
}

export interface NewQueueItem {
  question: string;
  approved: Public<string>;
  reason: EscalationReason;
  cartridgeId: string;
  cartridgeVersion: number;
}

export function createOfflineQueue<R>(deps: QueueDeps<R>) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => `q-${crypto.randomUUID()}`);
  const items = createStore<readonly QueueItem[]>([]);
  const sending = createStore<ReadonlySet<string>>(new Set());
  const approvals = new Map<string, Public<string>>();
  let draining: Promise<number> | undefined;
  let view: readonly QueueView[] = [];
  let viewOf: [readonly QueueItem[], ReadonlySet<string>] | undefined;

  const setItems = (next: readonly QueueItem[]) =>
    items.set([...next].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));

  async function sendOne(
    item: QueueItem,
    question: Public<string>,
  ): Promise<'sent' | 'offline' | 'failed'> {
    sending.set((s) => new Set([...s, item.id]));
    try {
      const result = await deps.send(item, question);
      await deps.storage.delete(item.id);
      approvals.delete(item.id);
      setItems(items.get().filter((i) => i.id !== item.id));
      deps.onAnswer?.(result, item);
      return 'sent';
    } catch (e) {
      if (e instanceof CloudError && e.code === 'OFFLINE') return 'offline';
      const failed = {
        ...item,
        attempts: item.attempts + 1,
        lastError: e instanceof Error ? e.message : String(e),
      };
      await deps.storage.put(failed).catch(() => undefined);
      setItems(items.get().map((i) => (i.id === item.id ? failed : i)));
      return 'failed';
    } finally {
      sending.set((s) => new Set([...s].filter((id) => id !== item.id)));
    }
  }

  async function runDrain(): Promise<number> {
    if (!deps.online()) return 0;
    const ready = items.get().filter((i) => approvals.has(i.id));
    if (ready.length === 0) return 0;
    if (!(await deps.probe())) return 0;
    let sent = 0;
    for (const item of ready) {
      const question = approvals.get(item.id);
      if (!question || !items.get().some((i) => i.id === item.id)) continue;
      const outcome = await sendOne(item, question);
      if (outcome === 'offline') break;
      if (outcome === 'sent') sent++;
    }
    return sent;
  }

  const queue = {
    subscribe(cb: () => void): () => void {
      const a = items.subscribe(cb);
      const b = sending.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    /** Snapshot for the UI (stable between changes, for useSyncExternalStore). */
    get(): readonly QueueView[] {
      const current: [readonly QueueItem[], ReadonlySet<string>] = [items.get(), sending.get()];
      if (!viewOf || viewOf[0] !== current[0] || viewOf[1] !== current[1]) {
        viewOf = current;
        view = current[0].map((i) => ({
          ...i,
          needsApproval: !approvals.has(i.id),
          sending: current[1].has(i.id),
        }));
      }
      return view;
    },
    /** Loads items saved earlier. They need a fresh approval before they are sent. */
    async load(): Promise<void> {
      const stored = await deps.storage.all();
      const known = new Set(items.get().map((i) => i.id));
      setItems([...items.get(), ...stored.filter((s) => !known.has(s.id))]);
    },
    async enqueue(input: NewQueueItem): Promise<QueueItem> {
      const item: QueueItem = {
        id: newId(),
        createdAt: now().toISOString(),
        question: input.question,
        reason: input.reason,
        cartridgeId: input.cartridgeId,
        cartridgeVersion: input.cartridgeVersion,
        attempts: 0,
      };
      await deps.storage.put(item);
      approvals.set(item.id, input.approved);
      setItems([...items.get(), item]);
      return item;
    },
    /** Attach a fresh approval (after a reload) and try to send. */
    async approve(id: string, approved: Public<string>): Promise<number> {
      if (!items.get().some((i) => i.id === id)) return 0;
      approvals.set(id, approved);
      viewOf = undefined;
      items.set([...items.get()]);
      return queue.drain();
    },
    async remove(id: string): Promise<void> {
      await deps.storage.delete(id);
      approvals.delete(id);
      setItems(items.get().filter((i) => i.id !== id));
    },
    /** Sends approved items after a real probe. Returns how many were sent. */
    drain(): Promise<number> {
      draining ??= runDrain().finally(() => {
        draining = undefined;
      });
      return draining;
    },
  };
  return queue;
}

export type OfflineQueue<R> = ReturnType<typeof createOfflineQueue<R>>;
