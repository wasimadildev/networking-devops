-- 0008_comments.sql
-- Comments hang off a task, and inherit the task's authorisation boundary: only
-- members of the task's project can read or write them.
--
-- ON DELETE CASCADE is correct here — a comment about a task that no longer
-- exists is not an orphan to be preserved, it is meaningless.

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comments_body_length CHECK (char_length(body) BETWEEN 1 AND 4000)
);

-- Comments are always read in chronological order for one task.
CREATE INDEX comments_task_created_idx ON comments (task_id, created_at ASC);
