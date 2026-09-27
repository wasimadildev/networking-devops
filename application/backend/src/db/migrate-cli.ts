import { closePool } from './pool.js';
import { getStatus, migrateUp, runSeed } from './migrator.js';
import { logger } from '../shared/logger.js';

/**
 * Migration CLI. Runs as its own short-lived process rather than on server
 * start, because "apply pending DDL" and "start serving traffic" are different
 * decisions and a health probe should never trigger a schema change.
 */
const main = async (): Promise<void> => {
  const [command = 'up'] = process.argv.slice(2);

  try {
    switch (command) {
      case 'up': {
        const { applied } = await migrateUp();
        logger.info({ applied, count: applied.length }, 'migrate up complete');
        break;
      }
      case 'status': {
        const status = await getStatus();
        logger.info({ status }, 'migration status');
        break;
      }
      case 'seed': {
        const { files } = await runSeed();
        logger.info({ files }, 'seed complete');
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}. Use up | status | seed`);
    }
  } catch (error) {
    logger.error({ err: error }, 'migration command failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
};

await main();
