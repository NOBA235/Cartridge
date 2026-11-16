import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Only src/privacy may reach the internal declassified minting function.
const PRIVACY_INTERNAL = {
  group: ['@/privacy/classified', '**/privacy/classified'],
  message: "Import from '@/privacy' instead.",
};

// The app uses only real models and real data. Stand-ins live in src/testing, for tests only.
const TEST_ONLY = {
  group: ['@/testing/*', '**/testing/*'],
  message: 'src/testing is for automated tests only. The app never uses stand-ins or sample data.',
};

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strict, prettier],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // All AI inference goes through Firebase AI Logic. The raw Chrome Prompt API is banned.
      'no-restricted-globals': [
        'error',
        {
          name: 'LanguageModel',
          message: 'Use Firebase AI Logic (src/ai), never the raw Chrome API.',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai).' },
        { object: 'self', property: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai).' },
        {
          object: 'globalThis',
          property: 'LanguageModel',
          message: 'Use Firebase AI Logic (src/ai).',
        },
      ],
      'no-restricted-imports': ['error', { patterns: [PRIVACY_INTERNAL, TEST_ONLY] }],
    },
  },
  {
    // Tests and test fixtures may use the stand-ins in src/testing.
    files: ['src/testing/**', '**/*.test.{ts,tsx}', '**/*.test-d.ts', '**/*.smoke.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [PRIVACY_INTERNAL] }] },
  },
  {
    files: ['src/privacy/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test-d.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [TEST_ONLY] }] },
  },
);
