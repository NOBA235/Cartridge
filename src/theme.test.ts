import { describe, expect, it } from 'vitest';
import { createThemeController, type Scheme, type StoredScheme, type ThemeEnv } from './theme';

function fakeEnv(initial: { stored?: StoredScheme; system?: Scheme } = {}) {
  let stored: StoredScheme = initial.stored ?? null;
  let system: Scheme = initial.system ?? 'light';
  let meta: 'light dark' | Scheme = 'light dark';
  let systemCb: ((s: Scheme) => void) | undefined;
  let storageCb: ((s: StoredScheme) => void) | undefined;

  const env: ThemeEnv = {
    getStored: () => stored,
    setStored: (v) => {
      stored = v;
    },
    getSystem: () => system,
    setMeta: (m) => {
      meta = m;
    },
    onSystemChange: (cb) => {
      systemCb = cb;
      return () => {
        systemCb = undefined;
      };
    },
    onStorageChange: (cb) => {
      storageCb = cb;
      return () => {
        storageCb = undefined;
      };
    },
  };

  return {
    env,
    read: () => ({ stored, system, meta }),
    emitSystem(next: Scheme) {
      system = next;
      systemCb?.(next);
    },
    emitStorage(next: StoredScheme) {
      stored = next;
      storageCb?.(next);
    },
  };
}

describe('theme controller', () => {
  it('follows the system preference by default with meta="light dark"', () => {
    const f = fakeEnv({ system: 'dark' });
    const ctrl = createThemeController(f.env);
    expect(ctrl.get()).toEqual({ stored: null, system: 'dark', resolved: 'dark' });
    expect(f.read().meta).toBe('light dark');
    f.emitSystem('light');
    expect(ctrl.get()).toEqual({ stored: null, system: 'light', resolved: 'light' });
  });

  it('stores an override on toggle, keeps it across OS switches, and removes it when toggling back to OS', () => {
    const f = fakeEnv({ system: 'light' });
    const ctrl = createThemeController(f.env);

    // 1. Toggle from light (OS) -> stores 'dark'
    ctrl.toggle();
    expect(ctrl.get()).toEqual({ stored: 'dark', system: 'light', resolved: 'dark' });
    expect(f.read()).toMatchObject({ stored: 'dark', meta: 'dark' });

    // 2. OS changes to dark -> stored override MUST be kept (not retroactively cleared)
    f.emitSystem('dark');
    expect(ctrl.get()).toEqual({ stored: 'dark', system: 'dark', resolved: 'dark' });
    expect(f.read().stored).toBe('dark');

    // 3. OS changes back to light -> stays pinned dark
    f.emitSystem('light');
    expect(ctrl.get()).toEqual({ stored: 'dark', system: 'light', resolved: 'dark' });

    // 4. Toggle again -> target ('light') matches OS -> removes stored entry & returns to 'light dark'
    ctrl.toggle();
    expect(ctrl.get()).toEqual({ stored: null, system: 'light', resolved: 'light' });
    expect(f.read()).toMatchObject({ stored: null, meta: 'light dark' });
  });

  it('syncs cross-tab storage changes into state and meta', () => {
    const f = fakeEnv({ system: 'dark' });
    const ctrl = createThemeController(f.env);
    f.emitStorage('light');
    expect(ctrl.get()).toEqual({ stored: 'light', system: 'dark', resolved: 'light' });
    expect(f.read().meta).toBe('light');
    f.emitStorage(null);
    expect(ctrl.get()).toEqual({ stored: null, system: 'dark', resolved: 'dark' });
    expect(f.read().meta).toBe('light dark');
  });
});
