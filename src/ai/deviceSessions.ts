/**
 * One Gemini Nano model per cartridge version (its response schema allows
 * exactly that version's rule IDs plus NONE), and its readiness for the UI.
 *
 * prepare() must start from a user gesture the first time, because it may
 * download the model. Once this browser has had a ready model, later visits
 * try prepare() automatically: that needs no gesture when the model is
 * already downloaded, and fails harmlessly (asking for the button) if not.
 *
 * A download that reports no progress for config.deviceStallMs is shown as
 * stopped, so the screen never waits forever; 'Try again' asks again (Chrome
 * keeps the part already downloaded). If the download finishes later anyway,
 * the model becomes ready then.
 */
import type { Cartridge } from '@/cartridge/types';
import { config } from '@/config';
import { createStore } from '@/lib/store';
import type { DeviceModel } from './deviceModel';
import { createDeviceModel } from './device';

export type DeviceState =
  | { state: 'idle' }
  | { state: 'preparing'; progress: number }
  | { state: 'ready' }
  /** canRetry is false when this browser or device can never run Gemini Nano. */
  | { state: 'unavailable'; reason: string; canRetry: boolean };

export const STALLED_REASON =
  'The download stopped making progress. Check the connection, then try again.';

const READY_KEY = 'cartridge.device.wasReady';

export function sessionKey(c: Pick<Cartridge, 'id' | 'version'>): string {
  return `${c.id}@${c.version}`;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createDeviceSessions(
  factory: (ruleIds: readonly string[]) => DeviceModel = createDeviceModel,
  options: { stallMs?: number } = {},
) {
  const stallMs = options.stallMs ?? config.deviceStallMs;
  const models = new Map<string, DeviceModel>();
  const states = createStore<Readonly<Record<string, DeviceState>>>({});
  const inflight = new Map<string, Promise<DeviceState>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const onStall = new Map<string, (s: DeviceState) => void>();

  const set = (key: string, s: DeviceState) => states.set((all) => ({ ...all, [key]: s }));
  const current = (key: string): DeviceState => states.get()[key] ?? { state: 'idle' };

  const unwatch = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  /** (Re)starts the no-progress timer for a download in progress. */
  const watch = (key: string) => {
    unwatch(key);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (current(key).state !== 'preparing') return;
        const stalled: DeviceState = {
          state: 'unavailable',
          reason: STALLED_REASON,
          canRetry: true,
        };
        set(key, stalled);
        onStall.get(key)?.(stalled);
      }, stallMs),
    );
  };

  const wasReady = () => {
    try {
      return globalThis.localStorage?.getItem(READY_KEY) === '1';
    } catch {
      return false;
    }
  };
  const rememberReady = (ready: boolean) => {
    try {
      if (ready) globalThis.localStorage?.setItem(READY_KEY, '1');
      else globalThis.localStorage?.removeItem(READY_KEY);
    } catch {
      // Storage unavailable: the button stays the way in.
    }
  };

  const sessions = {
    subscribe: states.subscribe,
    get: states.get,
    state(c: Pick<Cartridge, 'id' | 'version'>): DeviceState {
      return current(sessionKey(c));
    },
    handle(c: Cartridge): { model: DeviceModel; ready: boolean } | undefined {
      const model = models.get(sessionKey(c));
      return model ? { model, ready: sessions.state(c).state === 'ready' } : undefined;
    },
    prepare(c: Cartridge): Promise<DeviceState> {
      const key = sessionKey(c);
      const running = inflight.get(key);
      if (running) return running;
      let m = models.get(key);
      if (!m) {
        try {
          m = factory(c.rules.map((r) => r.id));
        } catch (e) {
          const failed: DeviceState = {
            state: 'unavailable',
            reason: messageOf(e),
            canRetry: false,
          };
          set(key, failed);
          return Promise.resolve(failed);
        }
        models.set(key, m);
      }
      set(key, { state: 'preparing', progress: 0 });
      watch(key);

      const work = m
        .prepare((progress) => {
          if (current(key).state === 'ready') return;
          // Also after a stall: the download is moving again.
          set(key, { state: 'preparing', progress });
          watch(key);
        })
        .then(
          (status): DeviceState =>
            status.state === 'ready'
              ? { state: 'ready' }
              : { state: 'unavailable', reason: status.reason, canRetry: !status.permanent },
          (e: unknown): DeviceState => ({
            state: 'unavailable',
            reason: messageOf(e),
            canRetry: true,
          }),
        )
        .then((next) => {
          // The real result always wins, even when it arrives after a stall.
          unwatch(key);
          rememberReady(next.state === 'ready');
          set(key, next);
          return next;
        });
      const stalled = new Promise<DeviceState>((resolve) => onStall.set(key, resolve));
      const p = Promise.race([work, stalled]).finally(() => {
        inflight.delete(key);
        onStall.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    /** Prepares without a gesture only if this browser had a ready model before. */
    autoPrepare(c: Cartridge): void {
      if (wasReady() && sessions.state(c).state === 'idle') void sessions.prepare(c);
    },
  };
  return sessions;
}

export const deviceSessions = createDeviceSessions();
