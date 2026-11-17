import { describe, expect, it } from 'vitest';
import { activeCartridge, resolveActiveId } from './active';
import type { CartridgeRecord } from './store';

const record = (id: string): CartridgeRecord => ({
  id,
  name: `${id}.pdf`,
  sourceId: '',
  sourceHash: 'h',
  currentVersion: 1,
  ruleCount: 3,
  updatedAt: '2026-11-14T00:00:00.000Z',
});

describe('active cartridge', () => {
  it('keeps the chosen cartridge while it is on this device', () => {
    expect(resolveActiveId('b', [record('a'), record('b')])).toBe('b');
  });

  it('falls back to the newest when the chosen one is gone or none was chosen', () => {
    expect(resolveActiveId('gone', [record('a'), record('b')])).toBe('a');
    expect(resolveActiveId(null, [record('a'), record('b')])).toBe('a');
  });

  it('is empty when there is no cartridge', () => {
    expect(resolveActiveId('a', [])).toBeNull();
    expect(resolveActiveId(null, [])).toBeNull();
  });

  it('tells listeners when the choice changes, and only then', () => {
    let calls = 0;
    const stop = activeCartridge.subscribe(() => calls++);
    activeCartridge.set('x');
    activeCartridge.set('x');
    activeCartridge.set('y');
    stop();
    expect(activeCartridge.get()).toBe('y');
    expect(calls).toBe(2);
  });
});
