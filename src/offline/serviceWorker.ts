/**
 * The offline app shell: a small, hand-written service worker, generated at
 * build time (see vite.config.ts) with the core app shell files.
 *
 * - Install: precaches only the core app shell (HTML, entry JS/CSS, pdf.js +
 *   worker, public assets), skipping heavy lazy screens like the Blueprint
 *   canvas (Excalidraw, diagram renderers, extra locales and fonts) so the
 *   first install stays fast and reliable.
 * - Pages: network first, so a new version arrives when there is signal; if
 *   the network fails or takes longer than navigationTimeoutMs, the cached
 *   page. Every app path (/ask, /report, /blueprint, ...) is the same page.
 * - Same-origin files: cache first; on a miss (such as Blueprint's lazy chunks
 *   and fonts on first open), fetch from the network and save OK responses in
 *   the current shell cache so they work offline afterwards.
 * - Anything on another origin (Firebase AI Logic, App Check, the signal
 *   check) and anything that is not a GET is never touched: it goes to the
 *   network as if there were no service worker, and is never cached.
 * - A new version waits until every tab of the old one is closed, so a page
 *   never mixes files from two builds. It then deletes the old cache (including
 *   runtime-cached lazy chunks from that build).
 */

export interface ServiceWorkerOptions {
  /** Changes whenever any built file changes. */
  version: string;
  /** Same-origin paths to cache on install, for example '/assets/index-abc.js'. */
  precache: readonly string[];
  navigationTimeoutMs?: number;
}

/** Minimal slice of Vite/Rollup's OutputBundle entries needed to find the core shell. */
export interface BundleEntry {
  readonly type: 'chunk' | 'asset';
  readonly isEntry?: boolean;
  readonly name?: string;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly viteMetadata?: {
    readonly importedCss?: ReadonlySet<string>;
    readonly importedAssets?: ReadonlySet<string>;
  };
}

/**
 * The Chinese, Japanese and Korean fallback font (12 MB in about 200 pieces) is
 * served but never precached: the browser fetches a piece only if a diagram
 * uses those characters, and runtime caching keeps it.
 */
const NOT_PRECACHED = /^fonts\/Xiaolai\//;

/** Heavy lazy screen chunks cached on first open instead of on SW install. */
const LAZY_SCREEN = /(?:^|\/)Blueprint\b/i;

/** Paths to cache: '/', '/index.html' and every listed file except the worker itself, source maps and excluded fonts. */
export function precacheList(fileNames: readonly string[]): string[] {
  const paths = new Set<string>(['/', '/index.html']);
  for (const name of fileNames) {
    const clean = name.replace(/^\/+/, '').replace(/\\/g, '/');
    if (clean === 'sw.js' || clean.endsWith('.map') || NOT_PRECACHED.test(clean)) continue;
    paths.add(`/${clean}`);
  }
  return [...paths].sort();
}

/**
 * Collects the core offline shell from a Vite bundle: entry chunks, their
 * static imports, imported CSS/assets, non-canvas dynamic imports (such as
 * pdf.js and its worker so PDF loading works offline immediately), and public
 * files. Excludes lazy Blueprint/Excalidraw chunks and Excalidraw's emitted
 * fonts, which are runtime-cached on first visit to /blueprint.
 */
export function corePrecacheList(
  bundle: Readonly<Record<string, BundleEntry>>,
  publicFiles: readonly string[],
  options: { excludeDynamic?: RegExp } = {},
): string[] {
  const exclude = options.excludeDynamic ?? LAZY_SCREEN;
  const visited = new Set<string>();
  const collected = new Set<string>();

  const visit = (fileName: string) => {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    collected.add(fileName);
    const entry = bundle[fileName];
    if (!entry || entry.type !== 'chunk') return;
    for (const imp of entry.imports ?? []) visit(imp);
    for (const css of entry.viteMetadata?.importedCss ?? []) collected.add(css);
    for (const asset of entry.viteMetadata?.importedAssets ?? []) collected.add(asset);
    for (const dyn of entry.dynamicImports ?? []) {
      const target = bundle[dyn];
      if (exclude.test(dyn) || (target?.name && exclude.test(target.name))) continue;
      visit(dyn);
    }
  };

  for (const [fileName, entry] of Object.entries(bundle)) {
    if (entry.type === 'chunk' && entry.isEntry) visit(fileName);
  }
  return precacheList([...collected, ...publicFiles]);
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
    caches.open(CACHE).then((cache) =>
      cache.match(request, MATCH).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone()).catch(() => {});
          return response;
        });
      }),
    ),
  );
});
`;
}
