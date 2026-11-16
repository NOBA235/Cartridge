import { beforeEach, describe, expect, it, vi } from 'vitest';
import { egressLog, PREVIEW_LIMIT, type EgressEntry, type EgressPersistence } from './egress';

const entry = (label: string) =>
  ({
    kind: 'cloud-call',
    label,
    bytesSent: 3,
    text: 'abc',
    origins: ['app'],
    status: 'ok',
  }) as const;

function memoryPersistence(initial: EgressEntry[] = []) {
  const saved: EgressEntry[] = [...initial];
  const p: EgressPersistence = {
    load: vi.fn(async () => [...initial]),
    save: vi.fn(async (e: EgressEntry) => {
      saved.push(e);
    }),
  };
  return { p, saved };
}

beforeEach(() => egressLog._reset());

describe('egress log persistence', () => {
  it('truncates long previews', () => {
    const e = egressLog.record({ ...entry('long'), text: 'x'.repeat(PREVIEW_LIMIT + 10) });
    expect(e.preview.length).toBe(PREVIEW_LIMIT + 1);
  });

  it('loads stored entries first and renumbers entries recorded before attaching', async () => {
    const old = { ...egressLog.record(entry('old')), id: 7 };
    egressLog._reset();
    egressLog.record(entry('early'));
    const { p, saved } = memoryPersistence([old]);
    await egressLog.attachPersistence(p);
    expect(egressLog.entries().map((e) => [e.id, e.label])).toEqual([
      [7, 'old'],
      [8, 'early'],
    ]);
    expect(saved.map((e) => e.label)).toEqual(['old', 'early']);
    expect(egressLog.persistence.get()).toBe('saved');
  });

  it('saves every new entry after attaching', async () => {
    const { p, saved } = memoryPersistence();
    await egressLog.attachPersistence(p);
    egressLog.record(entry('a'));
    egressLog.record(entry('b'));
    await Promise.resolve();
    expect(saved.map((e) => [e.id, e.label])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('keeps working in memory when storage fails', async () => {
    await egressLog.attachPersistence({
      load: () => Promise.reject(new Error('no IndexedDB')),
      save: () => Promise.resolve(),
    });
    expect(egressLog.persistence.get()).toBe('failed');
    egressLog.record(entry('still logged'));
    expect(egressLog.entries()).toHaveLength(1);
  });

  it('marks storage as failed when a save fails', async () => {
    await egressLog.attachPersistence({
      load: async () => [],
      save: () => Promise.reject(new Error('quota')),
    });
    egressLog.record(entry('x'));
    await new Promise((r) => setTimeout(r, 0));
    expect(egressLog.persistence.get()).toBe('failed');
    expect(egressLog.entries()).toHaveLength(1);
  });
});
