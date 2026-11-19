import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'experiments/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
      'boundaries/elements': [
        { type: 'engine', pattern: 'src/engine/**', partialMatch: false },
        { type: 'workers', pattern: 'src/workers/**', partialMatch: false },
        { type: 'ui', pattern: 'src/ui/**', partialMatch: false },
        { type: 'app', pattern: 'src/app/**', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'engine' } },
              allow: { to: { element: { type: 'engine' } } },
            },
            {
              from: { element: { type: 'workers' } },
              allow: { to: { element: { types: ['engine', 'workers'] } } },
            },
            {
              from: { element: { type: 'ui' } },
              allow: { to: { element: { types: ['engine', 'ui'] } } },
            },
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { types: ['engine', 'workers', 'ui', 'app'] } } },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'HTMLElement',
        'HTMLCanvasElement',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: ['preact', 'preact/*'],
        },
      ],
    },
  },
);
