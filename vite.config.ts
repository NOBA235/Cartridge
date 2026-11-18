import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildServiceWorker, precacheList } from './src/offline/serviceWorker.ts';

/** Writes dist/sw.js with the list of built files (see src/offline/serviceWorker.ts). */
function offlineShell(): Plugin {
  return {
    name: 'cartridge-offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle).sort();
      const hash = createHash('sha256');
      for (const name of names) {
        const item = bundle[name];
        hash.update(name);
        if (item?.type === 'chunk') hash.update(item.code);
        else if (item) hash.update(item.source);
      }
      const publicFiles = readdirSync(path.resolve(import.meta.dirname, 'public'));
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorker({
          version: hash.digest('hex').slice(0, 16),
          precache: precacheList([...names, ...publicFiles]),
        }),
      });
    },
  };
}

const FONTS_DIR = path.resolve(
  import.meta.dirname,
  'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);

function fontFiles(): string[] {
  return readdirSync(FONTS_DIR, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(FONTS_DIR, path.join(d.parentPath, d.name)).replace(/\\/g, '/'))
    .sort();
}

/**
 * Serves Excalidraw's fonts from this app at /fonts/ (window.EXCALIDRAW_ASSET_PATH
 * is '/'), so the canvas never fetches them from a CDN and works offline.
 * Build: copied into dist/fonts. Dev: served from node_modules.
 */
function canvasFonts(): Plugin {
  let build = false;
  return {
    name: 'cartridge-canvas-fonts',
    configResolved(c) {
      build = c.command === 'build' && !c.build.ssr;
    },
    buildStart() {
      if (!build) return;
      for (const file of fontFiles()) {
        this.emitFile({
          type: 'asset',
          fileName: `fonts/${file}`,
          source: readFileSync(path.join(FONTS_DIR, file)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use('/fonts/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const file = path.resolve(FONTS_DIR, rel);
        if (!file.startsWith(FONTS_DIR + path.sep) || !existsSync(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'font/woff2');
        res.end(readFileSync(file));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `vitest run --mode smoke` runs only the *.smoke.ts files, which make real
  // network calls. They are never part of `npm test`.
  const smoke = mode === 'smoke';
  return {
    plugins: [react(), tailwindcss(), canvasFonts(), offlineShell()],
    // Own ports, so service workers, caches and IndexedDB left at localhost:5173
    // by other projects can never serve their files to this app.
    server: { port: 5180, strictPort: true },
    preview: { port: 4180, strictPort: true },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    test: {
      environment: 'node',
      include: smoke ? ['src/**/*.smoke.ts'] : ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      typecheck: {
        enabled: !smoke,
        include: ['src/**/*.test-d.ts'],
        tsconfig: './tsconfig.app.json',
      },
    },
  };
});
