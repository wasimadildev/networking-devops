-- 0005_projects.sql
-- A project is the authorisation boundary. Nothing below it is readable or
-- writable without a row in project_members, which is why the owner is also
-- recorded here for traceability even though project_members is the source of
-- truth for permissions.

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        citext NOT NULL,
  description text,
  owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status      project_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Slugs are unique among live projects only, so a name can be recycled after a
-- project is archived instead of permanently burning the identifier.
CREATE UNIQUE INDEX projects_slug_active_key ON projects (slug) WHERE status = 'active';

CREATE INDEX projects_owner_idx ON projects (owner_id, updated_at DESC);

CREATE INDEX projects_status_updated_idx ON projects (status, updated_at DESC);
