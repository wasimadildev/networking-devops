import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, queryMany, withTransaction } from './pool.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('db.migrator');

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migrations live in application/db/migrations, one level above the compiled
 * output. `import.meta.url` is the only reliable anchor: `process.cwd()` is
 * whatever directory the process happened to be started from, which differs
 * between local `npm run dev`, a container entrypoint, and a CI job.
 */
export const MIGRATIONS_DIR = path.resolve(here, '../../../db/migrations');
export const SEED_DIR = path.resolve(here, '../../../db/seed');

const FILENAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

/**
 * A checksum is recorded on apply and re-checked on every run.
 *
 * Without it, editing an already-applied migration is silently accepted: the
 * database says "version 0007 is done" and the file on disk says something else,
 * so local and production schemas drift with no error anywhere. Failing loudly
 * is the only option that keeps the schema honest.
 */
const listMigrationFiles = async (): Promise<MigrationFile[]> => {
  const entries = await readdir(MIGRATIONS_DIR);

  const migrations = await Promise.all(
    entries
      .filter((filename) => FILENAME_PATTERN.test(filename))
      .sort((a, b) => a.localeCompare(b))
      .map(async (filename) => {
        const match = FILENAME_PATTERN.exec(filename);
        if (!match) throw new Error(`Malformed migration filename: ${filename}`);
        const [, version = '', name = ''] = match;

        const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');

        return {
          version,
          name,
          filename,
          sql,
          checksum: createHash('sha256').update(sql).digest('hex'),
        };
      }),
  );

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }

  return migrations;
};

const ensureMigrationsTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      name        text        NOT NULL,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    )
  `);
};

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  /** Wall-clock time the apply took, in milliseconds. */
  duration_ms: number | null;
}

export interface MigrationStatus {
  version: string;
  name: string;
  applied: boolean;
  checksumMismatch: boolean;
  durationMs: number | null;
}

export const getStatus = async (): Promise<MigrationStatus[]> => {
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  // duration_ms is selected because it is written on every apply; omitting it
  // left the status output permanently null, which reads as "we do not measure
  // this" rather than "we stored it and forgot to show it".
  const applied = await queryMany<AppliedRow>(
    'SELECT version, name, checksum, duration_ms FROM schema_migrations ORDER BY version',
  );
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  return files.map((file) => {
    const record = appliedByVersion.get(file.version);
    return {
      version: file.version,
      name: file.name,
      applied: Boolean(record),
      checksumMismatch: Boolean(record && record.checksum !== file.checksum),
      durationMs: record?.duration_ms ?? null,
    };
  });
};

/**
 * Applies every pending migration in filename order, one transaction each.
 *
 * One transaction per file rather than one for the batch: a batch would roll
 * back the earlier files too, and PostgreSQL DDL is transactional but real
 * migrations are written assuming each is a unit.
 */
export const migrateUp = async (): Promise<{ applied: string[] }> => {
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  const appliedRows = await queryMany<AppliedRow>(
    'SELECT version, name, checksum FROM schema_migrations',
  );
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));

  const drifted = files.filter((file) => {
    const record = appliedByVersion.get(file.version);
    return record && record.checksum !== file.checksum;
  });

  if (drifted.length > 0) {
    const names = drifted.map((file) => file.filename).join(', ');
    throw new Error(
      `Checksum mismatch for already-applied migration(s): ${names}. ` +
        'An applied migration was edited. Add a new migration instead of changing history.',
    );
  }

  const applied: string[] = [];

  for (const file of files) {
    if (appliedByVersion.has(file.version)) continue;

    const startedAt = Date.now();
    await withTransaction(async (client) => {
      await client.query(file.sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [file.version, file.name, file.checksum, Date.now() - startedAt],
      );
    });

    applied.push(file.filename);
    log.info({ migration: file.filename, durationMs: Date.now() - startedAt }, 'migration applied');
  }

  if (applied.length === 0) log.info('database already up to date');
  return { applied };
};

/**
 * Loads demo data. The seed is a plain SQL file for the same reason the
 * migrations are: you can read what it does and change it without a tool.
 */
export const runSeed = async (): Promise<{ files: string[] }> => {
  const entries = (await readdir(SEED_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const executed: string[] = [];

  for (const filename of entries) {
    const sql = await readFile(path.join(SEED_DIR, filename), 'utf8');
    await pool.query(sql);
    executed.push(filename);
    log.info({ seed: filename }, 'seed applied');
  }

  return { files: executed };
};
