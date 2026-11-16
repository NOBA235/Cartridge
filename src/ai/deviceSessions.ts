/**
 * One Gemini Nano model per cartridge version (its response schema allows
 * exactly that version's rule IDs plus NONE), and its readiness for the UI.
 *
 * prepare() must start from a user gesture the first time, because it may
 * download the model. Once this browser has had a ready model, later visits
 * try prepare() automatically: that needs no gesture when the model is
 * already downloaded, and fails harmlessly (asking for the button) if not.
 */
import type { Cartridge } from '@/cartridge/types';
import { createStore } from '@/lib/store';
import type { DeviceModel } from './deviceModel';
import { createDeviceModel } from './device';

export type DeviceState =
  | { state: 'idle' }
  | { state: 'preparing'; progress: number }
  | { state: 'ready' }
  | { state: 'unavailable'; reason: string };

const READY_KEY = 'cartridge.device.wasReady';

export function sessionKey(c: Pick<Cartridge, 'id' | 'version'>): string {
  return `${c.id}@${c.version}`;
}

export function createDeviceSessions(
  factory: (ruleIds: readonly string[]) => DeviceModel = createDeviceModel,
) {
  const models = new Map<string, DeviceModel>();
  const states = createStore<Readonly<Record<string, DeviceState>>>({});
  const inflight = new Map<string, Promise<DeviceState>>();

  const set = (key: string, s: DeviceState) => states.set((all) => ({ ...all, [key]: s }));

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
      return states.get()[sessionKey(c)] ?? { state: 'idle' };
    },
    handle(c: Cartridge): { model: DeviceModel; ready: boolean } | undefined {
      const model = models.get(sessionKey(c));
      return model ? { model, ready: sessions.state(c).state === 'ready' } : undefined;
    },
    prepare(c: Cartridge): Promise<DeviceState> {
      const key = sessionKey(c);
      const running = inflight.get(key);
      if (running) return running;
      let model = models.get(key);
      if (!model) {
        model = factory(c.rules.map((r) => r.id));
        models.set(key, model);
      }
      const m = model;
      set(key, { state: 'preparing', progress: 0 });
      const p = m
        .prepare((progress) => set(key, { state: 'preparing', progress }))
        .then((status): DeviceState => {
          const next: DeviceState =
            status.state === 'ready'
              ? { state: 'ready' }
              : { state: 'unavailable', reason: status.reason };
          rememberReady(next.state === 'ready');
          set(key, next);
          return next;
        })
        .finally(() => inflight.delete(key));
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
