import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/app-env.js';
import { closePool, query } from './db/pool.js';
import { logger } from './shared/logger.js';
import { unhandledRejectionGuard } from './middleware/error-handler.js';

unhandledRejectionGuard();

const app = createApp();
const server = createServer(app);

/**
 * server.close, promisified by hand.
 *
 * `promisify` has fourteen overloads for Node's callback conventions and picks
 * the wrong one for a single optional-error callback. Ten lines here are easier
 * to read than a cast that silences the compiler.
 */
const closeServer = (): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

/**
 * Generous, and on purpose. The default 5-second keep-alive timeout can drop a
 * connection the load balancer is about to reuse, which shows up as intermittent
 * 502s under load with no obvious cause.
 */
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

/**
 * Refuses new connections and finishes in-flight requests before exiting.
 *
 * A hard exit during a rolling deploy drops whatever the instance was serving.
 * Kubernetes sends SIGTERM and then waits `terminationGracePeriodSeconds`; this
 * handler is what makes that window useful instead of theoretical.
 */
let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown started');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  // server.close is callback-based, and passing an async callback to it makes the
  // promise it returns a floating one: a rejection inside becomes an unhandled
  // rejection instead of an orderly exit. promisify turns the callback contract
  // into a promise that can be chained, and the explicit `void` says the
  // rejection is already handled below rather than forgotten.
  void closeServer()
    .then(() => closePool())
    .then(() => {
      logger.info('shutdown complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * Fails fast if the database is unreachable at boot. Starting without a database
 * looks fine for a few seconds and then fails every request, which is harder to
 * diagnose than a container that never reports ready.
 */
const assertDatabaseReachable = async (): Promise<void> => {
  await query('SELECT 1');
};

try {
  await assertDatabaseReachable();
  logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'starting TaskFlow API');
  server.listen(env.PORT, env.HOST, () => {
    logger.info({ url: `http://${env.HOST}:${env.PORT}` }, 'TaskFlow API listening');
  });
} catch (error) {
  logger.fatal({ err: error }, 'failed to start: database unreachable');
  process.exit(1);
}

export { server };
