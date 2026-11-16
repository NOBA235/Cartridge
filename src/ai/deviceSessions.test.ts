import { describe, expect, it, vi } from 'vitest';
import { FIELD_CARTRIDGE } from '@/testing/fieldFixture';
import { MockDeviceModel } from '@/testing/mockDevice';
import type { DeviceModel } from './deviceModel';
import { createDeviceSessions } from './deviceSessions';

describe('device sessions', () => {
  it('creates one model per cartridge version with that version’s rule IDs', async () => {
    const factory = vi.fn(
      (_ids: readonly string[]): DeviceModel => new MockDeviceModel({ errorRate: 0 }),
    );
    const s = createDeviceSessions(factory);
    expect(s.handle(FIELD_CARTRIDGE)).toBeUndefined();
    await s.prepare(FIELD_CARTRIDGE);
    await s.prepare(FIELD_CARTRIDGE);
    await s.prepare({ ...FIELD_CARTRIDGE, version: 2 });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[0]?.[0]).toEqual(FIELD_CARTRIDGE.rules.map((r) => r.id));
    expect(s.state(FIELD_CARTRIDGE)).toEqual({ state: 'ready' });
    expect(s.handle(FIELD_CARTRIDGE)?.ready).toBe(true);
  });

  it('reports progress, then unavailable with the reason', async () => {
    const model: DeviceModel = {
      kind: 'firebase',
      prepare: async (onProgress) => {
        onProgress(0.4);
        return { state: 'unavailable', kind: 'firebase', reason: 'No Gemini Nano here' };
      },
      selectRule: async () => ({ ruleId: 'NONE', quantity: -1, source: 'mock' }),
    };
    const s = createDeviceSessions(() => model);
    const seen: unknown[] = [];
    s.subscribe(() => seen.push(s.state(FIELD_CARTRIDGE)));
    await s.prepare(FIELD_CARTRIDGE);
    expect(seen).toEqual([
      { state: 'preparing', progress: 0 },
      { state: 'preparing', progress: 0.4 },
      { state: 'unavailable', reason: 'No Gemini Nano here' },
    ]);
    expect(s.handle(FIELD_CARTRIDGE)?.ready).toBe(false);
  });

  it('prepares only once at a time', async () => {
    const prepare = vi.fn(async () => ({ state: 'ready' as const, kind: 'firebase' as const }));
    const s = createDeviceSessions(() => ({ kind: 'firebase', prepare, selectRule: vi.fn() }));
    await Promise.all([s.prepare(FIELD_CARTRIDGE), s.prepare(FIELD_CARTRIDGE)]);
    expect(prepare).toHaveBeenCalledOnce();
  });
});
