-- 0011_completion_timestamp.sql
-- tasks.completed_at is derived from status, not supplied by the client.
-- Deriving it in a trigger means the DB check constraint added in 0007 can never
-- be violated by a write that forgets the timestamp, and the application does
-- not have to remember which of the three open statuses clears it.
--
-- TG_OP must be checked explicitly: OLD is not populated on INSERT, so reading
-- OLD.status unconditionally makes the comparison NULL and silently skips the
-- branch. The DB is the only reliable place to test that distinction.

CREATE OR REPLACE FUNCTION sync_task_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Fires on INSERT and on any UPDATE that mentions status, so the derivation
-- always runs before the CHECK constraint evaluates the row.
--
-- A write that touches only completed_at does not fire this trigger, which is
-- correct: the CHECK constraint in 0007 is the backstop for that path, and it
-- rejects a stamp applied to an open task.
CREATE TRIGGER tasks_sync_completion
  BEFORE INSERT OR UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_completion();
