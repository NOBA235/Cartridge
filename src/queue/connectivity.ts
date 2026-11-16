/**
 * Whether the cloud can be reached.
 * - The browser's own online state (navigator.onLine and online/offline events).
 * - 'Simulated no signal': a switch that blocks every cloud call made through
 *   our code, for showing offline behaviour. Always labelled 'Simulated' in the UI.
 * - probe(): a real check before the offline queue is sent. One HEAD request
 *   with no content to the Firebase AI Logic host, logged in the egress log.
 */
import { createStore } from '@/lib/store';
import { egressLog } from '@/telemetry/egress';

export const PROBE_URL = 'https://firebasevertexai.googleapis.com/';

interface State {
  browserOnline: boolean;
  simulatedOffline: boolean;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const store = createStore<State>({ browserOnline: browserOnline(), simulatedOffline: false });
let listening = false;

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const sync = () => store.set((s) => ({ ...s, browserOnline: browserOnline() }));
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}

export type ProbeFetch = (url: string, init: RequestInit) => Promise<unknown>;

export const connectivity = {
  subscribe(cb: () => void): () => void {
    listen();
    return store.subscribe(cb);
  },
  get: store.get,
  /** True when our code may try the cloud. */
  online(): boolean {
    listen();
    const s = store.get();
    return s.browserOnline && !s.simulatedOffline;
  },
  setSimulatedOffline(on: boolean): void {
    store.set((s) => ({ ...s, simulatedOffline: on }));
  },
  /** Test helper. */
  _setBrowserOnline(on: boolean): void {
    store.set((s) => ({ ...s, browserOnline: on }));
  },
  /**
   * Real check. Resolves false while simulated offline, without any request.
   * 'no-cors' gives an opaque response: reaching the host at all is the signal.
   */
  async probe(fetchFn: ProbeFetch = (u, i) => fetch(u, i), timeoutMs = 8000): Promise<boolean> {
    if (!connectivity.online()) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let ok = false;
    let error: string | undefined;
    try {
      await fetchFn(PROBE_URL, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
    egressLog.record({
      kind: 'probe',
      label: 'Signal check before sending waiting questions',
      bytesSent: 0,
      text: `HEAD ${PROBE_URL} (no content sent)`,
      origins: [],
      status: ok ? 'ok' : 'error',
      ...(error ? { error } : {}),
    });
    return ok;
  },
};
