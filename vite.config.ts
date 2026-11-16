import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `vitest run --mode smoke` runs only the *.smoke.ts files, which make real
  // network calls. They are never part of `npm test`.
  const smoke = mode === 'smoke';
  return {
    plugins: [react(), tailwindcss()],
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
