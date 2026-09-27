-- 0009_activity_log.sql
-- Append-only audit trail. A bigserial primary key is used rather than uuid
-- because the only access pattern is "most recent N rows" and a monotonic key
-- keeps that index append-only instead of random.
--
-- metadata is JSONB, not a second table: the shape of the event payload changes
-- per action type, and modelling that relationally means a migration every time
-- a new event gains a field.

CREATE TABLE activity_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  project_id  uuid REFERENCES projects (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id   uuid,
  action      activity_action NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Project timeline: newest first, scoped to one project.
CREATE INDEX activity_log_project_created_idx
  ON activity_log (project_id, created_at DESC);

-- "What did this user do" audit view, independent of project.
CREATE INDEX activity_log_actor_created_idx
  ON activity_log (actor_id, created_at DESC);
