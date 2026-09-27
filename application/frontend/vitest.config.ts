import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // One file at a time. The component tests share a module-level session store
    // and a jsdom localStorage, so running files in parallel would interleave
    // sign-in state between suites and produce failures that depend on which file
    // happened to run first.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Thresholds are the point of configuring coverage at all. Without them a
      // report is decoration; with them, dropping below the floor fails the run.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
