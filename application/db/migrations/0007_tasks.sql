-- 0007_tasks.sql
-- The workhorse table. Three deliberate decisions here:
--
-- 1. project_id ON DELETE CASCADE. Deleting a project must not orphan tasks.
-- 2. assignee_id is nullable ON DELETE SET NULL. Removing a user from the
--    directory should unassign their work, not delete it.
-- 3. position is a gap-friendly ordering key, not a dense sequence. A dense
--    reindex on every drag-and-drop reorder rewrites the whole column and
--    bloats the table; a sparse key lets a single row be nudged.

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  status       task_status  NOT NULL DEFAULT 'todo',
  priority     task_priority NOT NULL DEFAULT 'medium',
  assignee_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  due_at       timestamptz,
  position     integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  -- A task cannot be marked done without a completion time, and cannot carry a
  -- completion time while still open. The invariant lives in the database so no
  -- code path can bypass it.
  CONSTRAINT tasks_completion_consistent CHECK (
    (status = 'done' AND completed_at IS NOT NULL) OR
    (status <> 'done' AND completed_at IS NULL)
  )
);

-- Board query: "tasks of this project, grouped by status, in board order".
CREATE INDEX tasks_project_board_idx ON tasks (project_id, status, position);

-- "Everything assigned to me" is the default landing query.
CREATE INDEX tasks_assignee_status_idx ON tasks (assignee_id, status)
  WHERE assignee_id IS NOT NULL;

-- Overdue queries filter on due_at within a project.
CREATE INDEX tasks_project_due_idx ON tasks (project_id, due_at)
  WHERE due_at IS NOT NULL;
