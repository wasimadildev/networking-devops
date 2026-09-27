-- 0006_project_members.sql
-- Many-to-many between users and projects, carrying the role that drives
-- authorisation.
--
-- The composite primary key makes a duplicate membership impossible at the
-- storage layer, so the application never has to defend against it and a
-- race between two "add member" requests cannot produce a double row.

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  role       project_member_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (project_id, user_id)
);

-- Supports the "which projects does this user belong to" lookup that renders
-- every list view. Without it that query degrades into a sequential scan once
-- the membership table grows.
CREATE INDEX project_members_user_idx ON project_members (user_id, created_at DESC);
