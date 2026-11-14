/**
 * User settings.
 *
 * 'Ask the cloud when needed':
 * - Ask screen: on by default, the user may switch it off.
 * - Blueprint canvas: off and locked. The canvas makes no automatic cloud calls.
 *   (A manual, previewed, approved send through declassify() is a separate,
 *   per-message action added in Phase 8.)
 */
import { createStore } from '@/lib/store';

export interface CloudWhenNeeded {
  readonly ask: boolean;
  readonly canvas: false;
}

export interface Settings {
  readonly cloudWhenNeeded: CloudWhenNeeded;
}

const STORAGE_KEY = 'cartridge.settings.v1';
const DEFAULTS: Settings = { cloudWhenNeeded: { ask: true, canvas: false } };

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as { cloudWhenNeeded?: { ask?: unknown } };
    const ask = parsed.cloudWhenNeeded?.ask;
    return { cloudWhenNeeded: { ask: typeof ask === 'boolean' ? ask : true, canvas: false } };
  } catch {
    return DEFAULTS;
  }
}

const store = createStore<Settings>(load());

function save(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); the setting still applies for this session.
  }
}

export const settings = {
  subscribe: store.subscribe,
  get: store.get,
  setAskCloudWhenNeeded(on: boolean): void {
    store.set((s) => ({ ...s, cloudWhenNeeded: { ...s.cloudWhenNeeded, ask: on } }));
    save(store.get());
  },
  /** Always false. There is deliberately no setter for the canvas. */
  canvasCloudWhenNeeded(): false {
    return false;
  },
  /** Test helper. */
  _reset(): void {
    store.set(DEFAULTS);
  },
};
