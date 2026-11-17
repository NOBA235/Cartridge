/**
 * The cartridge in the slot: the last one opened, made or imported, remembered
 * on this device. If that one is gone, screens fall back to the newest.
 */
import { createStore } from '@/lib/store';
import type { CartridgeRecord } from './store';

const KEY = 'cartridge.active.v1';

function load(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

const store = createStore<string | null>(load());

export const activeCartridge = {
  subscribe: store.subscribe,
  get: store.get,
  set(id: string): void {
    if (store.get() === id) return;
    store.set(id);
    try {
      globalThis.localStorage?.setItem(KEY, id);
    } catch {
      // Storage unavailable: the choice still holds for this session.
    }
  },
};

/** The chosen cartridge if it is still on this device, else the newest (records are newest first). */
export function resolveActiveId(
  explicit: string | null,
  records: readonly CartridgeRecord[],
): string | null {
  if (explicit && records.some((r) => r.id === explicit)) return explicit;
  return records[0]?.id ?? null;
}
