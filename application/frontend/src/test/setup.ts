import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Test setup.
 *
 * `localStorage` is cleared between tests because the token store is
 * module-level state: a token written by one test would otherwise be read by
 * the next, which is how "signs out on boot" passes in isolation and fails in
 * the suite.
 */
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
