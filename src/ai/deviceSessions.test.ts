import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDeviceModel } from '@/testing/mockDevice';
import type { DeviceModel, DeviceStatus } from './deviceModel';
import { createDeviceSessions, STALLED_REASON } from './deviceSessions';

describe('device sessions', () => {
  it('creates one shared model for the whole app', async () => {
    const factory = vi.fn((): DeviceModel => new MockDeviceModel({ errorRate: 0 }));
    const s = createDeviceSessions(factory);
    expect(s.handle()).toBeUndefined();
    await s.prepare();
    await s.prepare();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(s.state()).toEqual({ state: 'ready' });
    expect(s.handle()?.ready).toBe(true);
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
    s.subscribe(() => seen.push(s.state()));
    await s.prepare();
    expect(seen).toEqual([
      { state: 'preparing', progress: 0 },
      { state: 'preparing', progress: 0.4 },
      { state: 'unavailable', reason: 'No Gemini Nano here', canRetry: true },
    ]);
    expect(s.handle()?.ready).toBe(false);
  });

  it('offers no retry when the device can never run Gemini Nano', async () => {
    const s = createDeviceSessions(() => ({
      kind: 'firebase',
      prepare: async () => ({
        state: 'unavailable',
        kind: 'firebase',
        reason: 'Not supported',
        permanent: true,
      }),
      selectRule: vi.fn(),
    }));
    expect(await s.prepare()).toEqual({
      state: 'unavailable',
      reason: 'Not supported',
      canRetry: false,
    });
  });

  it('turns a thrown error into unavailable instead of preparing forever', async () => {
    const throwing = createDeviceSessions(() => {
      throw new Error('Firebase not configured');
    });
    expect(await throwing.prepare()).toMatchObject({
      state: 'unavailable',
      reason: 'Firebase not configured',
    });
    const rejecting = createDeviceSessions(() => ({
      kind: 'firebase',
      prepare: () => Promise.reject(new Error('Download interrupted')),
      selectRule: vi.fn(),
    }));
    expect(await rejecting.prepare()).toEqual({
      state: 'unavailable',
      reason: 'Download interrupted',
      canRetry: true,
    });
  });

  describe('a download that stops moving', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is shown as stopped, may be retried, and still becomes ready if it finishes', async () => {
      let report: (p: number) => void = () => {};
      let finish: () => void = () => {};
      const prepare = vi.fn(
        (onProgress: (p: number) => void) =>
          new Promise<DeviceStatus>((resolve) => {
            report = onProgress;
            finish = () => resolve({ state: 'ready', kind: 'firebase' });
          }),
      );
      const s = createDeviceSessions(() => ({ kind: 'firebase', prepare, selectRule: vi.fn() }), {
        stallMs: 1000,
      });
      const first = s.prepare();
      await vi.advanceTimersByTimeAsync(600);
      report(0.3);
      await vi.advanceTimersByTimeAsync(600);
      expect(s.state()).toEqual({ state: 'preparing', progress: 0.3 });

      await vi.advanceTimersByTimeAsync(1000);
      expect(await first).toEqual({ state: 'unavailable', reason: STALLED_REASON, canRetry: true });

      // Try again: a new request, not the stuck one.
      void s.prepare();
      expect(prepare).toHaveBeenCalledTimes(2);
      report(0.5);
      expect(s.state()).toEqual({ state: 'preparing', progress: 0.5 });
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.state()).toEqual({ state: 'ready' });
    });
  });

  it('prepares only once at a time', async () => {
    const prepare = vi.fn(async () => ({ state: 'ready' as const, kind: 'firebase' as const }));
    const s = createDeviceSessions(() => ({ kind: 'firebase', prepare, selectRule: vi.fn() }));
    await Promise.all([s.prepare(), s.prepare()]);
    expect(prepare).toHaveBeenCalledOnce();
  });
});
