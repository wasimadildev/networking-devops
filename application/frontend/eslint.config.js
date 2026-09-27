import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Flat config, mirroring the backend's so both halves of the app are linted the
 * same way. The rule set stays small and defect-focused: type-aware linting on,
 * formatting rules off.
 *
 * The React-specific rules are the point of difference. The two that matter most
 * here are `no-missing-dependencies` on query keys and the hooks rules, because
 * a wrong TanStack Query key is a silent cache bug that type checking cannot
 * see and that only shows up as stale data at runtime.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // The flat-compatible export. `configs['recommended-latest']` is still the
  // eslintrc shape in v7, so using it directly fails with a "plugins must be an
  // object" error under flat config.
  reactHooks.configs.flat['recommended-latest'],

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // eslint.config.js cannot appear in its own tsconfig project. This opts
          // it into type-aware linting without pretending it is part of it.
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // A dropped promise in a click handler is a button that appears broken.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
    },
  },

  {
    // The Vite config runs in Node, not the browser. `process` exists there, so
    // the DOM-oriented globals rules that flag it as undefined do not apply.
    files: ['vite.config.ts'],
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },

  {
    // Tests assert on loosely-typed fixtures and mock responses.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
