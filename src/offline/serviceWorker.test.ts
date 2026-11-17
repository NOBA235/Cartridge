import { describe, expect, it, vi } from 'vitest';
import { buildServiceWorker, precacheList } from './serviceWorker';

const ORIGIN = 'https://app.test';

interface FakeRequest {
  method: string;
  url: string;
  mode?: string;
}

/** A minimal CacheStorage keyed by path. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const pathOf = (r: string | FakeRequest) =>
    new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      // Like a real server for module scripts: responses carry 'Vary: Origin'.
      addAll: async (urls: string[]) => {
        for (const u of urls)
          store.set(pathOf(u), new Response(`cached ${u}`, { headers: { Vary: 'Origin' } }));
      },
      // Like the Cache API, a Vary header stops the match unless ignoreVary is set
      // (the page's requests carry an Origin header the install request did not).
      match: async (r: string | FakeRequest, options?: { ignoreVary?: boolean }) => {
        const hit = store.get(pathOf(r));
        if (hit?.headers.get('Vary') && !options?.ignoreVary) return undefined;
        return hit?.clone();
      },
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
  };
}

function load(fetchImpl: (r: FakeRequest) => Promise<Response>, timeoutMs = 3000) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, f: (e: unknown) => void) => {
      listeners[type] = f;
    },
    location: { origin: ORIGIN },
    clients: { claim: vi.fn(async () => {}) },
  };
  const caches = fakeCaches();
  const fetch = vi.fn(fetchImpl);
  const script = buildServiceWorker({
    version: 'v2',
    precache: ['/', '/index.html', '/assets/app.js'],
    navigationTimeoutMs: timeoutMs,
  });
  new Function('self', 'caches', 'fetch', 'Response', script)(self, caches.api, fetch, Response);

  const run = async (type: string) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners[type]?.({ waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  /** Returns the response the worker chose, or undefined if it let the request through. */
  const request = async (r: FakeRequest) => {
    let chosen: Promise<Response> | undefined;
    listeners['fetch']?.({ request: r, respondWith: (p: Promise<Response>) => (chosen = p) });
    return chosen ? await chosen : undefined;
  };
  return { run, request, fetch, caches, self };
}

const get = (path: string, mode?: string): FakeRequest => ({
  method: 'GET',
  url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
  ...(mode ? { mode } : {}),
});

describe('offline app shell', () => {
  it('lists every built file once, without the worker itself or source maps', () => {
    expect(
      precacheList([
        'assets/index-a.js',
        'assets/index-a.js.map',
        'sw.js',
        'index.html',
        'favicon.svg',
      ]),
    ).toEqual(['/', '/assets/index-a.js', '/favicon.svg', '/index.html']);
  });

  it('caches the shell on install and serves the page from it without signal', async () => {
    const sw = load(() => Promise.reject(new TypeError('Failed to fetch')));
    await sw.run('install');
    const page = await sw.request(get('/report?id=x', 'navigate'));
    expect(await page?.text()).toBe('cached /index.html');
    const asset = await sw.request(get('/assets/app.js'));
    expect(await asset?.text()).toBe('cached /assets/app.js');
  });

  it('prefers the network for pages, so a new version arrives', async () => {
    const sw = load(async () => new Response('fresh page'));
    await sw.run('install');
    const page = await sw.request(get('/ask', 'navigate'));
    expect(await page?.text()).toBe('fresh page');
  });

  it('falls back to the saved page when the network is too slow', async () => {
    const sw = load(() => new Promise<Response>(() => {}), 20);
    await sw.run('install');
    const page = await sw.request(get('/', 'navigate'));
    expect(await page?.text()).toBe('cached /index.html');
  });

  it('serves built files from the cache, and fetches files it does not have', async () => {
    const sw = load(async () => new Response('from network'));
    await sw.run('install');
    await sw.request(get('/assets/app.js'));
    expect(sw.fetch).not.toHaveBeenCalled();
    const other = await sw.request(get('/favicon.ico'));
    expect(await other?.text()).toBe('from network');
  });

  it('never touches other origins or requests that are not GET', async () => {
    const sw = load(async () => new Response('x'));
    await sw.run('install');
    expect(
      await sw.request(get('https://firebasevertexai.googleapis.com/v1beta/models:generate')),
    ).toBeUndefined();
    expect(await sw.request(get('https://www.gstatic.com/generate_204'))).toBeUndefined();
    expect(await sw.request({ method: 'POST', url: `${ORIGIN}/assets/app.js` })).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it('deletes older shells when it takes over, and nothing else', async () => {
    const sw = load(async () => new Response('x'));
    await sw.caches.api.open('cartridge-shell-v1');
    await sw.caches.api.open('someone-else');
    await sw.run('install');
    await sw.run('activate');
    expect([...sw.caches.stores.keys()].sort()).toEqual(['cartridge-shell-v2', 'someone-else']);
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
  });
});
