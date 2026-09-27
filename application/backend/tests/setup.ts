/**
 * Test environment.
 *
 * Set before any application module is imported, because `config/env.ts`
 * validates on import and would otherwise fail on the missing secrets. Values
 * here are deliberately obvious test values — a secret that looks like a
 * production secret is a secret that ends up in git.
 */
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://localhost/taskflow_test';
process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-not-used-anywhere-else-01';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-not-used-anywhere-01';
process.env['JWT_ACCESS_TTL'] = '15m';
process.env['JWT_REFRESH_TTL'] = '7d';
// Cost 4 is the bcrypt minimum. Tests hash a lot; cost 12 would add minutes to
// the suite for no extra confidence, and the cost is not what is under test.
process.env['BCRYPT_COST'] = '4';
// Logs are silenced by NODE_ENV in shared/logger.ts, not by a LOG_LEVEL value.
process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:5173';
