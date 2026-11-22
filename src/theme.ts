/**
 * Color scheme controller following modern web color-scheme best practices:
 * - Default: follow system preference (no localStorage entry, <meta name="color-scheme" content="light dark">).
 * - Override: stored literally as 'light' or 'dark' in localStorage['color-scheme'] and reflected in <meta>.
 * - Two-state toggle: flips the currently rendered scheme; if the new target matches the current system
 *   preference, removes the stored override (reverting cleanly to system) instead of pinning it.
 * - Never clears a stored override retroactively when the OS scheme changes to match it.
 * - Syncs across tabs via 'storage' and tracks OS changes via matchMedia('change').
 */
import { createStore } from '@/lib/store';

export type Scheme = 'light' | 'dark';
export type StoredScheme = Scheme | null;

export interface ThemeSnapshot {
  readonly stored: StoredScheme;
  readonly system: Scheme;
  readonly resolved: Scheme;
}

export const THEME_STORAGE_KEY = 'color-scheme';

export interface ThemeEnv {
  getStored(): StoredScheme;
  setStored(value: StoredScheme): void;
  getSystem(): Scheme;
  setMeta(content: 'light dark' | Scheme): void;
  onSystemChange?(cb: (system: Scheme) => void): () => void;
  onStorageChange?(cb: (stored: StoredScheme) => void): () => void;
}

export function parseStoredScheme(raw: string | null | undefined): StoredScheme {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

function browserEnv(): ThemeEnv {
  const mq =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  return {
    getStored() {
      try {
        return parseStoredScheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
      } catch {
        return null;
      }
    },
    setStored(value) {
      try {
        if (value === null) globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
        else globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value);
      } catch {
        // Storage blocked (e.g. private mode): the <meta> tag still applies for this session.
      }
    },
    getSystem() {
      return mq?.matches ? 'dark' : 'light';
    },
    setMeta(content) {
      if (typeof document === 'undefined') return;
      let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'color-scheme';
        document.head.appendChild(meta);
      }
      meta.content = content;
    },
    onSystemChange(cb) {
      if (!mq) return () => {};
      const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    },
    onStorageChange(cb) {
      if (typeof window === 'undefined') return () => {};
      const handler = (e: StorageEvent) => {
        if (e.key === null || e.key === THEME_STORAGE_KEY) {
          cb(parseStoredScheme(e.newValue));
        }
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}

function snapshot(stored: StoredScheme, system: Scheme): ThemeSnapshot {
  return { stored, system, resolved: stored ?? system };
}

export function createThemeController(env: ThemeEnv) {
  const store = createStore<ThemeSnapshot>(snapshot(env.getStored(), env.getSystem()));

  const apply = (stored: StoredScheme, system: Scheme, persist: boolean) => {
    if (persist) env.setStored(stored);
    env.setMeta(stored ?? 'light dark');
    store.set(snapshot(stored, system));
  };

  // Ensure DOM <meta> matches initial state even when constructed dynamically.
  const init = store.get();
  env.setMeta(init.stored ?? 'light dark');

  const unsubSystem = env.onSystemChange?.((system) => {
    // Keep any existing stored override intact when OS changes (do not retroactively clear).
    const cur = store.get();
    store.set(snapshot(cur.stored, system));
  });

  const unsubStorage = env.onStorageChange?.((stored) => {
    const cur = store.get();
    apply(stored, cur.system, false);
  });

  return {
    subscribe: store.subscribe,
    get: store.get,
    /** Two-state toggle: switches to opposite of rendered scheme, or reverts to system if they match. */
    toggle(): ThemeSnapshot {
      const cur = store.get();
      const target: Scheme = cur.resolved === 'dark' ? 'light' : 'dark';
      const nextStored: StoredScheme = target === cur.system ? null : target;
      apply(nextStored, cur.system, true);
      return store.get();
    },
    /** Explicitly set light, dark, or null (follow system). */
    set(stored: StoredScheme): ThemeSnapshot {
      apply(stored, store.get().system, true);
      return store.get();
    },
    destroy(): void {
      unsubSystem?.();
      unsubStorage?.();
    },
  };
}

export const theme = createThemeController(browserEnv());
