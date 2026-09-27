-- 0003_users.sql
-- Identity table. Email is CITEXT so 'A@x.com' and 'a@x.com' cannot both exist,
-- which would otherwise turn a login lookup into a two-row surprise.
--
-- password_hash stores a bcrypt digest, never a reversible value. The column is
-- named to make that impossible to forget at a call site.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext   NOT NULL,
  password_hash text     NOT NULL,
  display_name  text     NOT NULL,
  role          user_role NOT NULL DEFAULT 'member',
  is_active     boolean  NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Partial unique index: a deactivated account must not block a re-registration
-- of the same address, but two live accounts still cannot collide.
CREATE UNIQUE INDEX users_email_active_key ON users (email) WHERE is_active;

CREATE INDEX users_created_at_idx ON users (created_at DESC);
