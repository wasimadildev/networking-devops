import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Suites share one PostgreSQL database, so they must not interleave. A
    // single fork keeps the fixtures predictable; raising this needs per-worker
    // databases, which is more setup than this suite is worth.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['tests/setup.ts'],
    // The migrator and repository tests each hold a real transaction. Generous,
    // but a timeout that fires mid-migration leaves the database in a state the
    // next run cannot recover from.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'coverage/junit.xml' },
  },
});
