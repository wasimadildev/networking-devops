-- 0001_extensions.sql
-- Extensions and the migration bookkeeping table.
--
-- The migration runner creates schema_migrations itself; this file only
-- establishes the extensions every later migration depends on.

CREATE EXTENSION IF NOT EXISTS citext;

-- gen_random_uuid() is built into PostgreSQL 13+ and does not require pgcrypto.
-- The DB is the only source of ids so the id space stays consistent no matter
-- which tier inserts a row.
