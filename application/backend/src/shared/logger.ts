import { pino, type Logger } from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Logs are JSON on stdout, one object per line, so a log collector can parse
 * them without a grok pattern. `pino-pretty` is a dev-only human formatter and
 * is deliberately not a dependency — formatting belongs at the edge, not in the
 * app.
 *
 * Redaction is not optional here. A request body containing a password must
 * never reach disk, so the risky keys are stripped at the serialiser rather than
 * remembered at each call site.
 */
export const logger: Logger = pino({
  // Test runs are silenced by NODE_ENV rather than by a `LOG_LEVEL=silent`
  // value. Allowing "silent" in the LOG_LEVEL enum would mean a single typo in
  // a production environment variable turns off every log line, and the
  // resulting outage is invisible: the app is healthy and says nothing.
  // `silent` is a real pino level, so it costs nothing to select here.
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'taskflow-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'password_hash',
      '*.password_hash',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'token',
      '*.token',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction ? {} : { transport: undefined }),
});

export const childLogger = (module: string): Logger => logger.child({ module });
