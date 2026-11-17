/**
 * The offline app shell: a small, hand-written service worker, generated at
 * build time (see vite.config.ts) with the exact list of built files.
 *
 * - Install: caches every built file (HTML, JS, CSS, the pdf.js worker, the icon).
 * - Pages: network first, so a new version arrives when there is signal; if
 *   the network fails or takes longer than navigationTimeoutMs, the cached
 *   page. Every app path (/ask, /report, ...) is the same page.
 * - Built files: from the cache, else the network.
 * - Anything on another origin (Firebase AI Logic, App Check, the signal
 *   check) and anything that is not a GET is never touched: it goes to the
 *   network as if there were no service worker, and is never cached.
 * - A new version waits until every tab of the old one is closed, so a page
 *   never mixes files from two builds. It then deletes the old cache.
 */

export interface ServiceWorkerOptions {
  /** Changes whenever any built file changes. */
  version: string;
  /** Same-origin paths to cache on install, for example '/assets/index-abc.js'. */
  precache: readonly string[];
  navigationTimeoutMs?: number;
}

/** Paths to cache: '/', '/index.html' and every built or public file except the worker itself and source maps. */
export function precacheList(fileNames: readonly string[]): string[] {
  const paths = new Set<string>(['/', '/index.html']);
  for (const name of fileNames) {
    const clean = name.replace(/^\/+/, '').replace(/\\/g, '/');
    if (clean === 'sw.js' || clean.endsWith('.map')) continue;
    paths.add(`/${clean}`);
  }
  return [...paths].sort();
}

/** The service worker script. Plain JavaScript, no imports. */
export function buildServiceWorker(o: ServiceWorkerOptions): string {
  const timeout = o.navigationTimeoutMs ?? 3000;
  return `// Cartridge offline app shell. Generated at build time; do not edit.
const CACHE = ${JSON.stringify(`cartridge-shell-${o.version}`)};
const PRECACHE = ${JSON.stringify(o.precache)};
const NAVIGATION_TIMEOUT_MS = ${timeout};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('cartridge-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Built files are named by their content, so a 'Vary' header (for example
// 'Vary: Origin' on module scripts, which are requested with an Origin
// header) must not stop a match.
const MATCH = { ignoreSearch: true, ignoreVary: true };

function cachedPage() {
  return caches
    .open(CACHE)
    .then((cache) => cache.match('/index.html', MATCH))
    .then((hit) => hit || new Response('Offline, and this page is not saved yet.', { status: 503 }));
}

function pageFromNetwork(request) {
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => {
      if (done) return;
      done = true;
      resolve(cachedPage());
    };
    const timer = setTimeout(fallback, NAVIGATION_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        resolve(response.ok ? response : cachedPage());
      },
      () => {
        clearTimeout(timer);
        fallback();
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(pageFromNetwork(request));
    return;
  }
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, MATCH))
      .then((hit) => hit || fetch(request)),
  );
});
`;
}
