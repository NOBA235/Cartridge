/**
 * Registers the offline app shell (src/offline/serviceWorker.ts) in production
 * builds. 'ready' means every app file is saved on this device, so the app
 * opens and reloads without a signal.
 */
import { createStore } from '@/lib/store';

export type OfflineShellState = 'not-used' | 'saving' | 'ready' | 'unavailable';

const store = createStore<OfflineShellState>('not-used');

export const offlineShell = { subscribe: store.subscribe, get: store.get };

export function registerOfflineShell(): void {
  // Dev builds change on every save; a cached shell would only get in the way.
  if (!import.meta.env.PROD) return;
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) {
    store.set('unavailable');
    return;
  }
  store.set('saving');
  sw.register('/sw.js').then(
    () =>
      void sw.ready.then(
        () => store.set('ready'),
        () => store.set('unavailable'),
      ),
    () => store.set('unavailable'),
  );
}
