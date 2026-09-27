-- Enforce "a project always has at least one owner" in the database.
--
-- Why here and not only in the service: the invariant is about the *state* of
-- the projects table, so every writer has to respect it, and writers include
-- future endpoints, background jobs, and a DBA at a psql prompt at 2am. A
-- service-layer check protects one code path; this protects the table.
--
-- The service still checks, and that is intentional rather than redundant: it
-- returns a 422 with a useful message instead of surfacing a constraint
-- violation, and the trigger is the backstop when a check is forgotten.

CREATE OR REPLACE FUNCTION enforce_project_has_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_owners integer;
BEGIN
  -- Only a DELETE or a demotion away from 'owner' can orphan a project.
  IF TG_OP = 'DELETE' AND OLD.role <> 'owner' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  IF OLD.role <> 'owner' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Exclude the row being changed, so demoting the *last* owner counts zero
  -- while demoting one of several still counts the others.
  SELECT count(*) INTO remaining_owners
    FROM project_members
   WHERE project_id = OLD.project_id
     AND role = 'owner'
     AND user_id <> OLD.user_id;

  IF remaining_owners = 0 THEN
    RAISE EXCEPTION 'project % must keep at least one owner', OLD.project_id
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER project_members_require_owner
  BEFORE DELETE OR UPDATE OF role ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_project_has_owner();

-- Ownership transfer: promoting a member to owner is an owner-only action, and
-- the route that performs it is a deliberate, explicit operation rather than a
-- side effect of changing someone's role down to 'editor'.
CREATE OR REPLACE FUNCTION promote_member_to_owner(
  p_project_id uuid,
  p_user_id uuid,
  p_new_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  previous_owner_id uuid;
BEGIN
  SELECT owner_id INTO previous_owner_id
    FROM projects
   WHERE id = p_project_id
     AND owner_id = p_new_owner_id;  -- the caller must be the current owner

  IF previous_owner_id IS NULL THEN
    RAISE EXCEPTION 'only the current owner can transfer ownership of project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE project_members SET role = 'owner' WHERE project_id = p_project_id AND user_id = p_user_id;
  UPDATE project_members SET role = 'editor' WHERE project_id = p_project_id AND user_id = p_new_owner_id;
  UPDATE projects SET owner_id = p_user_id WHERE id = p_project_id;
END;
$$;

COMMENT ON FUNCTION promote_member_to_owner(uuid, uuid, uuid) IS
  'Transfers project ownership in one transaction: the new owner is promoted, '
  'the old owner steps down to editor, and projects.owner_id follows. Ordering '
  'matters — the new owner is promoted before the old one is demoted, so the '
  'enforce_project_has_owner trigger never sees a zero-owner moment.';
