import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat config. ESLint 9 has no eslintrc, so this is the only shape available.
 *
 * The rule set is deliberately small. Type-aware linting is on (the compiler is
 * already running a project), but stylistic rules are off: Prettier-style
 * formatting is a matter of taste and a large diff, while the rules kept here
 * catch defects — an unhandled promise, an `any` that erases a type check, a
 * floating `await`.
 */
export default tseslint.config(
  {
    // Build output and dependencies are not ours to lint.
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // This file is the one TypeScript file that cannot be in tsconfig —
          // it is the config tsconfig would be read through. allowDefaultProject
          // opts it into type-aware linting without lying about the project.
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `any` erases the compiler's ability to check a value, which is the
      // opposite of what a strict TypeScript project is for.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // A floating promise is a silent bug: a failed refresh or a dropped
      // request produces no error and no log.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Express handlers are synchronous or return void; returning a promise to
      // Express 5 is supported, but a handler that forgets to await is not.
      '@typescript-eslint/require-await': 'error',

      // An empty catch is how a swallowed error becomes a mystery.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // `==`/`!=` coerce; in a codebase full of ids, strings and nulls that is a
      // bug waiting for the wrong type to arrive.
      eqeqeq: ['error', 'always'],
    },
  },

  {
    // Tests assert on loosely-typed HTTP bodies, which are `any` by nature.
    // Fighting that with casts in every test would be noise, and the type
    // checking that matters happens at the API boundary the tests exercise.
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
