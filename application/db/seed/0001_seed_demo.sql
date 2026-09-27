-- 0001_seed_demo.sql
-- Deterministic demo data. Every account uses the same password: Passw0rd!
-- The hash below is a real bcrypt (cost 12) digest of that string, generated and
-- verified — a placeholder here produces "invalid salt" at login and wastes an
-- afternoon.
--
-- Idempotent: re-running truncates the domain tables and rebuilds the same rows,
-- so `npm run db:seed` is always safe. refresh_tokens is deliberately NOT
-- truncated — wiping live sessions as a side effect of seeding is a hostile
-- default.

TRUNCATE TABLE
  comments,
  tasks,
  project_members,
  activity_log,
  projects
RESTART IDENTITY CASCADE;

-- project.owner_id is ON DELETE RESTRICT, so demo users that already own a
-- project from a previous run must go first.
DELETE FROM users
WHERE email IN (
  'ada@taskflow.dev',
  'grace@taskflow.dev',
  'alan@taskflow.dev',
  'edsger@taskflow.dev'
);

INSERT INTO users (email, password_hash, display_name, role) VALUES
  ('ada@taskflow.dev',    '$2b$12$/7PTgjJMtFUgokqVhsrdo.ELkxdmScso3oVj/mFP37dH7V8X/ucjG', 'Ada Lovelace',    'admin'),
  ('grace@taskflow.dev',  '$2b$12$/7PTgjJMtFUgokqVhsrdo.ELkxdmScso3oVj/mFP37dH7V8X/ucjG', 'Grace Hopper',    'member'),
  ('alan@taskflow.dev',   '$2b$12$/7PTgjJMtFUgokqVhsrdo.ELkxdmScso3oVj/mFP37dH7V8X/ucjG', 'Alan Turing',     'member'),
  ('edsger@taskflow.dev', '$2b$12$/7PTgjJMtFUgokqVhsrdo.ELkxdmScso3oVj/mFP37dH7V8X/ucjG', 'Edsger Dijkstra', 'member');

INSERT INTO projects (name, slug, description, owner_id)
SELECT v.name, v.slug, v.description, u.id
FROM (VALUES
  ('Platform Migration',   'platform-migration',
   'Move the reporting stack off the legacy host and onto the new 3-tier platform.',
   'ada@taskflow.dev'),
  ('Observability Rollout','observability-rollout',
   'Structured logs, metrics and traces for every tier.',
   'grace@taskflow.dev')
) AS v(name, slug, description, owner_email)
JOIN users u ON u.email = v.owner_email;

-- Membership is the authorisation boundary. Without these rows the owners could
-- not even read their own projects.
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, u.id, v.role::project_member_role
FROM (VALUES
  ('platform-migration',    'ada@taskflow.dev',   'owner'),
  ('platform-migration',    'grace@taskflow.dev', 'editor'),
  ('platform-migration',    'alan@taskflow.dev',  'viewer'),
  ('observability-rollout', 'grace@taskflow.dev', 'owner'),
  ('observability-rollout', 'edsger@taskflow.dev','editor')
) AS v(project_slug, user_email, role)
JOIN projects p ON p.slug = v.project_slug
JOIN users    u ON u.email = v.user_email;

-- position is spaced by 1000 so a later reorder nudges one card instead of
-- renumbering the column. That is the whole point of a gap-friendly key.
INSERT INTO tasks (
  project_id, title, description, status, priority,
  assignee_id, created_by, position, due_at
)
SELECT p.id, v.title, v.description,
       v.status::task_status, v.priority::task_priority,
       a.id, c.id, v.position,
       CASE WHEN v.due_in_days IS NULL THEN NULL
            ELSE now() + make_interval(days => v.due_in_days) END
FROM (VALUES
  ('platform-migration', 'Provision the new app subnet',    'Reserve 10.50.2.0/24 and attach an NSG with default deny inbound.', 'todo',        'high',   'ada@taskflow.dev',   'ada@taskflow.dev',   0,    3),
  ('platform-migration', 'Load test the API tier',          'Sustained 200 rps for 10 minutes, p95 under 250ms.',                     'in_progress', 'urgent', 'grace@taskflow.dev', 'ada@taskflow.dev',   1000, 1),
  ('platform-migration', 'Rotate the database credentials', 'Two-person rotation. New secret in the environment, never in git.',       'todo',        'urgent', 'ada@taskflow.dev',   'ada@taskflow.dev',   2000, 2),
  ('platform-migration', 'Write the runbook',               'What breaks, who owns it, how to roll back.',                            'todo',        'medium', 'alan@taskflow.dev',  'ada@taskflow.dev',   3000, 14),
  ('platform-migration', 'Decommission the legacy host',    'Drain, snapshot, then release the reservation.',                          'todo',        'low',    'ada@taskflow.dev',   'ada@taskflow.dev',   4000, 30),
  ('platform-migration', 'Cut over DNS',                    'Lower the TTL a week ahead, switch the record, raise it again.',        'done',        'high',   'grace@taskflow.dev', 'ada@taskflow.dev',   5000, NULL)
) AS v(project_slug, title, description, status, priority, assignee_email, author_email, position, due_in_days)
JOIN projects p ON p.slug = v.project_slug
JOIN users    a ON a.email = v.assignee_email
JOIN users    c ON c.email = v.author_email;

INSERT INTO tasks (
  project_id, title, description, status, priority,
  assignee_id, created_by, position, due_at
)
SELECT p.id, v.title, v.description,
       v.status::task_status, v.priority::task_priority,
       a.id, c.id, v.position, NULL
FROM (VALUES
  ('observability-rollout', 'Define the log schema',   'One event shape for all three tiers, so a query works everywhere.', 'done',        'high',   'grace@taskflow.dev', 'grace@taskflow.dev', 0),
  ('observability-rollout', 'Instrument the API tier', 'Request id, duration and status on every route.',                  'in_progress', 'high',   'grace@taskflow.dev', 'grace@taskflow.dev', 1000),
  ('observability-rollout', 'Add a metrics endpoint',  'Expose counts and latency histograms for scraping.',               'todo',        'medium', 'grace@taskflow.dev', 'grace@taskflow.dev', 2000),
  ('observability-rollout', 'Alert on 5xx rate',       'Page when the error budget burns faster than agreed.',            'todo',        'urgent', 'grace@taskflow.dev', 'grace@taskflow.dev', 3000)
) AS v(project_slug, title, description, status, priority, assignee_email, author_email, position)
JOIN projects p ON p.slug = v.project_slug
JOIN users    a ON a.email = v.assignee_email
JOIN users    c ON c.email = v.author_email;

INSERT INTO comments (task_id, author_id, body)
SELECT t.id, u.id, v.body
FROM (VALUES
  ('platform-migration', 'Provision the new app subnet',       'ada@taskflow.dev',   'Reserved a /28 inside the /24 so a future zone needs no new plan.'),
  ('platform-migration', 'Load test the API tier',             'grace@taskflow.dev', 'p95 landed at 210ms last run. Pool size was the bottleneck, not the app.'),
  ('platform-migration', 'Rotate the database credentials',    'ada@taskflow.dev',   'Two-person change: I run it, Grace verifies the new credential before the old one goes.'),
  ('observability-rollout','Instrument the API tier',          'grace@taskflow.dev', 'Request id is already threaded through the logger. Durations and status next.')
) AS v(project_slug, task_title, author_email, body)
JOIN tasks t ON t.title = v.task_title
JOIN users  u ON u.email = v.author_email
JOIN projects p ON p.id = t.project_id AND p.slug = v.project_slug;

INSERT INTO activity_log (actor_id, project_id, entity_type, entity_id, action, metadata)
SELECT u.id, p.id, 'project', p.id, 'project.created',
       jsonb_build_object('name', p.name, 'slug', p.slug)
FROM (VALUES
  ('platform-migration',    'ada@taskflow.dev'),
  ('observability-rollout', 'grace@taskflow.dev')
) AS v(project_slug, actor_email)
JOIN projects p ON p.slug = v.project_slug
JOIN users    u ON u.email = v.actor_email;
