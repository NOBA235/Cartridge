/**
 * One shared Gemini Nano session for the whole app. Because the response schema
 * is fixed at 5 candidate slots (C1..C5 plus NONE), the same prepared model
 * serves every cartridge and every version without re-initialising.
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

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createDeviceSessions(
  factory: () => DeviceModel = createDeviceModel,
  options: { stallMs?: number } = {},
) {
  const stallMs = options.stallMs ?? config.deviceStallMs;
  let model: DeviceModel | undefined;
  const stateStore = createStore<DeviceState>({ state: 'idle' });
  let inflight: Promise<DeviceState> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStall: ((s: DeviceState) => void) | undefined;

  const set = (s: DeviceState) => stateStore.set(s);
  const current = (): DeviceState => stateStore.get();

  const unwatch = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  /** (Re)starts the no-progress timer for a download in progress. */
  const watch = () => {
    unwatch();
    timer = setTimeout(() => {
      timer = undefined;
      if (current().state !== 'preparing') return;
      const stalled: DeviceState = {
        state: 'unavailable',
        reason: STALLED_REASON,
        canRetry: true,
      };
      set(stalled);
      onStall?.(stalled);
    }, stallMs);
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
    subscribe: stateStore.subscribe,
    get: stateStore.get,
    state(): DeviceState {
      return current();
    },
    handle(): { model: DeviceModel; ready: boolean } | undefined {
      return model ? { model, ready: current().state === 'ready' } : undefined;
    },
    prepare(): Promise<DeviceState> {
      if (inflight) return inflight;
      if (!model) {
        try {
          model = factory();
        } catch (e) {
          const failed: DeviceState = {
            state: 'unavailable',
            reason: messageOf(e),
            canRetry: false,
          };
          set(failed);
          return Promise.resolve(failed);
        }
      }
      set({ state: 'preparing', progress: 0 });
      watch();

      const work = model
        .prepare((progress) => {
          if (current().state === 'ready') return;
          // Also after a stall: the download is moving again.
          set({ state: 'preparing', progress });
          watch();
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
          unwatch();
          rememberReady(next.state === 'ready');
          set(next);
          return next;
        });
      const stalled = new Promise<DeviceState>((resolve) => {
        onStall = resolve;
      });
      const p = Promise.race([work, stalled]).finally(() => {
        inflight = undefined;
        onStall = undefined;
      });
      inflight = p;
      return p;
    },
    /** Prepares without a gesture only if this browser had a ready model before. */
    autoPrepare(): void {
      if (wasReady() && current().state === 'idle') void sessions.prepare();
    },
  };
  return sessions;
}

export const deviceSessions = createDeviceSessions();
