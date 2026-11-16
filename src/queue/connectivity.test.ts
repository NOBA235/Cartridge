import { beforeEach, describe, expect, it, vi } from 'vitest';
import { egressLog } from '@/telemetry/egress';
import { connectivity, PROBE_URL } from './connectivity';

beforeEach(() => {
  egressLog._reset();
  connectivity._setBrowserOnline(true);
  connectivity.setSimulatedOffline(false);
});

describe('connectivity', () => {
  it('is offline while the browser is offline or no signal is simulated', () => {
    expect(connectivity.online()).toBe(true);
    connectivity.setSimulatedOffline(true);
    expect(connectivity.online()).toBe(false);
    connectivity.setSimulatedOffline(false);
    connectivity._setBrowserOnline(false);
    expect(connectivity.online()).toBe(false);
  });

  it('probes with one HEAD request and no content, and logs it', async () => {
    const fetchFn = vi.fn(async () => ({}));
    expect(await connectivity.probe(fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      PROBE_URL,
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors', cache: 'no-store' }),
    );
    expect(egressLog.entries()).toEqual([
      expect.objectContaining({ kind: 'probe', bytesSent: 0, status: 'ok' }),
    ]);
  });

  it('reports a failed probe', async () => {
    expect(
      await connectivity.probe(async () => Promise.reject(new TypeError('Failed to fetch'))),
    ).toBe(false);
    expect(egressLog.entries()[0]).toMatchObject({
      kind: 'probe',
      status: 'error',
      error: 'Failed to fetch',
    });
  });

  it('makes no request at all while no signal is simulated', async () => {
    connectivity.setSimulatedOffline(true);
    const fetchFn = vi.fn(async () => ({}));
    expect(await connectivity.probe(fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(egressLog.entries()).toEqual([]);
  });

  it('notifies listeners', () => {
    const cb = vi.fn();
    const off = connectivity.subscribe(cb);
    connectivity.setSimulatedOffline(true);
    off();
    connectivity.setSimulatedOffline(false);
    expect(cb).toHaveBeenCalledOnce();
  });
});
