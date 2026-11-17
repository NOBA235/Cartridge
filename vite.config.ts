import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildServiceWorker, precacheList } from './src/offline/serviceWorker';

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `vitest run --mode smoke` runs only the *.smoke.ts files, which make real
  // network calls. They are never part of `npm test`.
  const smoke = mode === 'smoke';
  return {
    plugins: [react(), tailwindcss(), offlineShell()],
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
