-- 0002_enums.sql
-- Enums are declared once, here, so that every table referencing a status uses
-- the same vocabulary. Using CHECK constraints on text would drift; using native
-- enums gives the planner a compact type and makes invalid values unrepresentable
-- at the storage layer, not just at the API layer.

CREATE TYPE user_role AS ENUM ('member', 'admin');

CREATE TYPE project_status AS ENUM ('active', 'archived');

CREATE TYPE project_member_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done');

CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TYPE activity_action AS ENUM (
  'project.created',
  'project.updated',
  'project.archived',
  'project.member_added',
  'project.member_role_changed',
  'project.member_removed',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.deleted',
  'comment.created',
  'comment.deleted'
);
