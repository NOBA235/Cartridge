import { describe, expect, it, vi } from 'vitest';
import { CloudError } from '@/ai/cloud';
import { asPrivate, declassify, grantApproval, type Public } from '@/privacy';
import { createOfflineQueue, type QueueItem, type QueueStorage } from './offlineQueue';

function memoryStorage(initial: QueueItem[] = []) {
  const data = new Map(initial.map((i) => [i.id, i]));
  const storage: QueueStorage = {
    all: async () => [...data.values()],
    put: async (i) => {
      data.set(i.id, i);
    },
    delete: async (id) => {
      data.delete(id);
    },
  };
  return { storage, data };
}

function approved(text: string): Public<string> {
  return declassify(
    asPrivate(text, 'user-question'),
    grantApproval(text, { purpose: 'test', scope: 'ask' }),
  );
}

function setup(
  opts: {
    online?: boolean;
    probe?: boolean;
    initial?: QueueItem[];
    send?: (i: QueueItem) => Promise<string>;
  } = {},
) {
  const state = { online: opts.online ?? false, probe: opts.probe ?? true };
  const { storage, data } = memoryStorage(opts.initial);
  const probe = vi.fn(async () => state.probe);
  const send = vi.fn(opts.send ?? (async (i: QueueItem) => `answer to ${i.question}`));
  const answers: Array<[string, string]> = [];
  let n = 0;
  const queue = createOfflineQueue<string>({
    storage,
    probe,
    online: () => state.online,
    send: (item) => send(item),
    onAnswer: (result, item) => answers.push([item.id, result]),
    now: () => new Date(`2026-11-16T12:00:0${n}Z`),
    newId: () => `q${++n}`,
  });
  return { queue, state, data, probe, send, answers };
}

const input = (question: string) => ({
  question,
  approved: approved(question),
  reason: 'LOW_RETRIEVAL' as const,
  cartridgeId: 'ctg-1',
  cartridgeVersion: 1,
});

describe('offline queue', () => {
  it('stores a question while offline and sends nothing', async () => {
    const t = setup();
    await t.queue.enqueue(input('How do I treat a snake bite?'));
    expect(t.data.size).toBe(1);
    expect(await t.queue.drain()).toBe(0);
    expect(t.probe).not.toHaveBeenCalled();
    expect(t.send).not.toHaveBeenCalled();
    expect(t.queue.get()).toEqual([
      expect.objectContaining({
        question: 'How do I treat a snake bite?',
        needsApproval: false,
        sending: false,
      }),
    ]);
  });

  it('does not send when the browser says online but the real probe fails', async () => {
    const t = setup();
    await t.queue.enqueue(input('q'));
    t.state.online = true;
    t.state.probe = false;
    expect(await t.queue.drain()).toBe(0);
    expect(t.probe).toHaveBeenCalledOnce();
    expect(t.send).not.toHaveBeenCalled();
    expect(t.data.size).toBe(1);
  });

  it('sends in order after a good probe, then removes the items', async () => {
    const t = setup();
    await t.queue.enqueue(input('first'));
    await t.queue.enqueue(input('second'));
    t.state.online = true;
    expect(await t.queue.drain()).toBe(2);
    expect(t.send.mock.calls.map(([i]) => i.question)).toEqual(['first', 'second']);
    expect(t.answers).toEqual([
      ['q1', 'answer to first'],
      ['q2', 'answer to second'],
    ]);
    expect(t.data.size).toBe(0);
    expect(t.queue.get()).toEqual([]);
  });

  it('keeps a failed item with its error and retries it on the next drain', async () => {
    let fail = true;
    const t = setup({
      online: true,
      send: async (i) => {
        if (fail) throw new CloudError('quota exceeded', 'FAILED', 3);
        return `ok ${i.question}`;
      },
    });
    await t.queue.enqueue(input('q'));
    expect(await t.queue.drain()).toBe(0);
    expect(t.queue.get()[0]).toMatchObject({
      attempts: 1,
      lastError: 'quota exceeded',
      needsApproval: false,
    });
    expect(t.data.get('q1')?.attempts).toBe(1);
    fail = false;
    expect(await t.queue.drain()).toBe(1);
    expect(t.data.size).toBe(0);
  });

  it('stops at the first OFFLINE error and keeps the rest', async () => {
    const t = setup({
      online: true,
      send: async () => {
        throw new CloudError('No signal', 'OFFLINE', 0);
      },
    });
    await t.queue.enqueue(input('a'));
    await t.queue.enqueue(input('b'));
    expect(await t.queue.drain()).toBe(0);
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.queue.get().map((i) => i.attempts)).toEqual([0, 0]);
  });

  it('never sends items restored from storage until the user approves them again', async () => {
    const saved: QueueItem = {
      id: 'old',
      createdAt: '2026-11-15T10:00:00Z',
      question: 'saved before reload',
      reason: 'NO_MATCH',
      cartridgeId: 'ctg-1',
      cartridgeVersion: 1,
      attempts: 0,
    };
    const t = setup({ online: true, initial: [saved] });
    await t.queue.load();
    expect(t.queue.get()).toEqual([expect.objectContaining({ id: 'old', needsApproval: true })]);
    expect(await t.queue.drain()).toBe(0);
    expect(t.probe).not.toHaveBeenCalled();
    expect(await t.queue.approve('old', approved('saved before reload'))).toBe(1);
    expect(t.answers).toEqual([['old', 'answer to saved before reload']]);
  });

  it('runs one drain at a time', async () => {
    let release: () => void = () => {};
    const t = setup({ online: true, send: () => new Promise((r) => (release = () => r('done'))) });
    await t.queue.enqueue(input('q'));
    const a = t.queue.drain();
    const b = t.queue.drain();
    expect(a).toBe(b);
    await vi.waitFor(() => expect(t.queue.get()[0]?.sending).toBe(true));
    release();
    expect(await a).toBe(1);
    expect(t.send).toHaveBeenCalledOnce();
  });

  it('removes an item on request', async () => {
    const t = setup();
    await t.queue.enqueue(input('q'));
    await t.queue.remove('q1');
    expect(t.data.size).toBe(0);
    expect(t.queue.get()).toEqual([]);
  });
});
