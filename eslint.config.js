import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
        { name: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai), never the raw Chrome API.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai).' },
        { object: 'self', property: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai).' },
        { object: 'globalThis', property: 'LanguageModel', message: 'Use Firebase AI Logic (src/ai).' },
      ],
    },
  },
);
