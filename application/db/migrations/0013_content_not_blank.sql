-- Close two validation gaps that only the API boundary was covering.
--
-- Both of these are already enforced by a zod schema, so nothing is newly
-- rejected by a well-behaved client. They are here because a CHECK constraint
-- holds for every writer, and the writers are not only the API: a seed script,
-- a data fix, a psql session, or a future endpoint that forgets the schema.
--
-- Applied as new constraints rather than edits to 0003/0008. Migrations that
-- have already run are history; changing one means the checksum recorded in
-- schema_migrations no longer matches the file, and every environment applies
-- a different schema from the same migration list.

ALTER TABLE users
  ADD CONSTRAINT users_email_non_blank CHECK (char_length(btrim(email)) BETWEEN 3 AND 320),
  ADD CONSTRAINT users_display_name_non_blank CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80);

-- char_length(body) BETWEEN 1 AND 4000 already exists on comments, but a body of
-- '   ' has length 3 and passes it. btrim makes "has visible content" the rule
-- rather than "has bytes", which is what a reader of the thread cares about.
ALTER TABLE comments
  ADD CONSTRAINT comments_body_not_whitespace CHECK (char_length(btrim(body)) >= 1);

-- Same reasoning for task titles: a task called "  " is a bug report waiting to
-- happen, and the API trims but the column did not.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_title_not_whitespace CHECK (char_length(btrim(title)) >= 1);

COMMENT ON CONSTRAINT users_email_non_blank ON users IS
  'Length, not just presence: a 320-character ceiling stops a caller smuggling an '
  'unbounded string into an index entry, and a 3-character floor rejects the '
  'obvious typos that a presence check would accept.';

COMMENT ON CONSTRAINT comments_body_not_whitespace ON comments IS
  'btrim rather than char_length alone. The pre-existing length constraint counts '
  'whitespace as content, so a comment of spaces satisfied it.';
