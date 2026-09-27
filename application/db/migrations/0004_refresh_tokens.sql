-- 0004_refresh_tokens.sql
-- Refresh tokens are stored as a SHA-256 digest of the opaque token, not as the
-- token itself. A stolen database backup therefore does not hand an attacker a
-- usable credential: the plaintext never exists at rest.
--
-- Rotation is enforced by the unique index on token_hash: presenting the same
-- refresh token twice is a detectable replay, not a silent no-op.

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  family_id  uuid        NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now(),
  user_agent text,
  ip_address inet
);

CREATE UNIQUE INDEX refresh_tokens_hash_key ON refresh_tokens (token_hash);

-- Revoked rows are retained for a grace period so replay can be detected and
-- logged, then swept. This index serves that cleanup job.
CREATE INDEX refresh_tokens_user_active_idx
  ON refresh_tokens (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
