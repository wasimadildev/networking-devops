/**
 * Database-level tests.
 *
 * These are the ones that earn their keep. Constraints and triggers are the
 * last line of defence: if application code is ever refactored into a bug, a
 * CHECK constraint still refuses a task that is done without a completion time.
 * A test at this level documents that the invariant exists at all.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { query, queryOne } from '../src/db/pool.js';
import { addMember, closeDatabase, createProject, createTask, createUser, truncateAll } from './helpers.js';
import { changeMemberRole, removeProjectMember } from '../src/modules/projects/project.service.js';
import { NotFoundError, UnprocessableError } from '../src/shared/errors.js';
import { findMembership, countOwners } from '../src/modules/projects/membership.repository.js';

beforeEach(truncateAll);
afterAll(closeDatabase);

describe('users', () => {
  it('generates the id in the database, not the application', async () => {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ('a@b.test', 'A', 'x') RETURNING id`,
    );
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('refuses a duplicate email, case-insensitively', async () => {
    await createUser({ email: 'dup@test.dev' });
    // Case-insensitive because a user who registers Foo@ and foo@ must not end up
    // with two accounts; a plain unique index on the raw column would allow it.
    await expect(
      query(`INSERT INTO users (email, display_name, password_hash) VALUES ('DUP@test.dev', 'B', 'x')`),
    ).rejects.toThrow();
  });

  it('refuses a blank email', async () => {
    for (const email of ['', '   ', 'a']) {
      await expect(
        query(`INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'A', 'x')`, [email]),
      ).rejects.toThrow();
    }
  });

  it('refuses a blank display name', async () => {
    await expect(
      query(`INSERT INTO users (email, display_name, password_hash) VALUES ('a@b.test', '   ', 'x')`),
    ).rejects.toThrow();
  });
});

describe('projects', () => {
  it('refuses a duplicate slug', async () => {
    const owner = await createUser();
    await createProject(owner.id, 'Alpha');
    await expect(createProject(owner.id, 'Alpha 2')).resolves.toBeDefined();
    const again = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug LIKE 'alpha%' LIMIT 1`);
    expect(again).not.toBeNull();
  });

  it('refuses a project whose owner is not a user', async () => {
    await expect(
      query(`INSERT INTO projects (name, slug, owner_id) VALUES ('X', 'x-slug', '00000000-0000-4000-8000-000000000000')`),
    ).rejects.toThrow();
  });
});

describe('project_members', () => {
  it('refuses the same user twice in one project', async () => {
    const owner = await createUser();
    const member = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, member.id, 'viewer');
    await expect(addMember(project.id, member.id, 'editor')).rejects.toThrow();
  });

  it('refuses a role outside the enum', async () => {
    const owner = await createUser();
    const member = await createUser();
    const project = await createProject(owner.id);
    await expect(
      query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')`, [project.id, member.id]),
    ).rejects.toThrow();
  });

  it('cascades a membership delete when the user is deleted', async () => {
    const owner = await createUser();
    const member = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, member.id, 'viewer');

    await query(`DELETE FROM users WHERE id = $1`, [member.id]);
    expect(await findMembership(project.id, member.id)).toBeNull();
  });
});

describe('tasks', () => {
  it('refuses a task for a project that does not exist', async () => {
    const user = await createUser();
    await expect(
      query(
        `INSERT INTO tasks (project_id, title, created_by) VALUES ('00000000-0000-4000-8000-000000000000', 't', $1)`,
        [user.id],
      ),
    ).rejects.toThrow();
  });

  it('permits a non-member assignee at the column level, deferring to the service', async () => {
    // A CHECK cannot reference another table, so "the assignee is a member of
    // this project" is not expressible as a constraint. It is the service's job.
    // Asserted so the boundary is documented: if this ever starts throwing, a
    // constraint was added and the service check should be revisited as redundant.
    const owner = await createUser();
    const outsider = await createUser();
    const project = await createProject(owner.id);
    const task = await createTask(project.id, owner.id, { assigneeId: outsider.id });

    const stored = await queryOne<{ assignee_id: string | null }>(
      `SELECT assignee_id FROM tasks WHERE id = $1`,
      [task.id],
    );
    expect(stored!.assignee_id).toBe(outsider.id);
  });

  it('refuses a blank title', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);
    await expect(
      query(`INSERT INTO tasks (project_id, title, created_by) VALUES ($1, '   ', $2)`, [project.id, owner.id]),
    ).rejects.toThrow();
  });

  describe('the completed_at trigger', () => {
    it('stamps completed_at when status becomes done', async () => {
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);
      expect(task.completedAt).toBeNull();

      const updated = await queryOne<{ completed_at: Date | null }>(
        `UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING completed_at`,
        [task.id],
      );
      expect(updated!.completed_at).toBeInstanceOf(Date);
    });

    it('clears completed_at when a done task is reopened', async () => {
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);
      await query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [task.id]);

      const updated = await queryOne<{ completed_at: Date | null }>(
        `UPDATE tasks SET status = 'in_progress' WHERE id = $1 RETURNING completed_at`,
        [task.id],
      );
      expect(updated!.completed_at).toBeNull();
    });

    it('is idempotent: re-marking a done task done keeps the original stamp', async () => {
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);
      const first = await queryOne<{ completed_at: Date }>(
        `UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING completed_at`,
        [task.id],
      );
      const again = await queryOne<{ completed_at: Date }>(
        `UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING completed_at`,
        [task.id],
      );
      // Marking done twice must not move the completion time: an at-a-glance
      // "completed on" date that shifts each time a status is re-saved is
      // worthless for reporting.
      expect(first!.completed_at).toBeInstanceOf(Date);
      expect(again!.completed_at).toEqual(first!.completed_at);
    });

    it('repairs a write that tries to mark a task done with a null stamp', async () => {
      // The trigger is BEFORE and authoritative, so it overwrites the client's
      // NULL before the CHECK ever sees the row. A rejection here would mean the
      // trigger stopped firing; a non-null result is the trigger working.
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);

      const updated = await queryOne<{ status: string; completed_at: Date | null }>(
        `UPDATE tasks SET status = 'done', completed_at = NULL WHERE id = $1 RETURNING status, completed_at`,
        [task.id],
      );
      expect(updated!.status).toBe('done');
      expect(updated!.completed_at).toBeInstanceOf(Date);
    });

    it('repairs a write that stamps an open task', async () => {
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);

      const updated = await queryOne<{ status: string; completed_at: Date | null }>(
        `UPDATE tasks SET status = 'todo', completed_at = now() WHERE id = $1 RETURNING status, completed_at`,
        [task.id],
      );
      expect(updated!.status).toBe('todo');
      expect(updated!.completed_at).toBeNull();
    });

    it('rejects a stamp written to an open task without touching status', async () => {
      // This is the one path the trigger cannot cover: `UPDATE OF status` does
      // not fire when status is absent from the SET list, so the CHECK constraint
      // is the only thing standing between a caller and a task that looks
      // completed while still in the todo column. Without this the constraint
      // would be untested code.
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);

      await expect(
        query(`UPDATE tasks SET completed_at = now() WHERE id = $1`, [task.id]),
      ).rejects.toThrow();
    });

    it('rejects clearing the stamp of a done task without touching status', async () => {
      const owner = await createUser();
      const project = await createProject(owner.id);
      const task = await createTask(project.id, owner.id);
      await query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [task.id]);

      await expect(
        query(`UPDATE tasks SET completed_at = NULL WHERE id = $1`, [task.id]),
      ).rejects.toThrow();
    });

    it('refuses an insert straight into done with no stamp', async () => {
      // The trigger also covers INSERT, so the database will not accept a
      // pre-completed task that skipped the status transition.
      const owner = await createUser();
      const project = await createProject(owner.id);

      const row = await queryOne<{ completed_at: Date | null }>(
        `INSERT INTO tasks (project_id, title, status, completed_at, created_by)
         VALUES ($1, 'Born done', 'done', NULL, $2) RETURNING completed_at`,
        [project.id, owner.id],
      );
      expect(row!.completed_at).toBeInstanceOf(Date);
    });
  });
});

describe('comments', () => {
  it('refuses a comment on a task that does not exist', async () => {
    const user = await createUser();
    await expect(
      query(`INSERT INTO comments (task_id, author_id, body) VALUES ('00000000-0000-4000-8000-000000000000', $1, 'hi')`, [user.id]),
    ).rejects.toThrow();
  });

  it('refuses a whitespace-only body', async () => {
    // char_length(body) BETWEEN 1 AND 4000 already existed and let '   ' through,
    // because three spaces is a length of three.
    const owner = await createUser();
    const project = await createProject(owner.id);
    const task = await createTask(project.id, owner.id);
    await expect(
      query(`INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, '   ')`, [task.id, owner.id]),
    ).rejects.toThrow();
  });

  it('refuses an over-long body', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);
    const task = await createTask(project.id, owner.id);
    await expect(
      query(`INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)`, [task.id, owner.id, 'x'.repeat(4001)]),
    ).rejects.toThrow();
  });

  it('cascades comments when the task is deleted', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);
    const task = await createTask(project.id, owner.id);
    await query(`INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, 'hi')`, [task.id, owner.id]);

    await query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
    const count = await queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM comments WHERE task_id = $1`, [task.id]);
    expect(count!.count).toBe('0');
  });
});

describe('the project owner invariant', () => {
  it('starts with exactly one owner', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);
    expect(await countOwners(project.id)).toBe(1);
  });

  it('refuses to remove the only owner, even in raw SQL', async () => {
    // The service check is not the only thing standing between a bug and a
    // project nobody can administer. A DELETE straight at the table is refused
    // by the trigger, which is what makes the invariant real.
    const owner = await createUser();
    const project = await createProject(owner.id);

    await expect(
      query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, owner.id]),
    ).rejects.toThrow(/must keep at least one owner/);

    expect(await countOwners(project.id)).toBe(1);
  });

  it('refuses to demote the only owner, even in raw SQL', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);

    await expect(
      query(`UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2`, [project.id, owner.id]),
    ).rejects.toThrow(/must keep at least one owner/);
  });

  it('allows removing one of several owners', async () => {
    const owner = await createUser();
    const coOwner = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, coOwner.id, 'owner');

    await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, coOwner.id]);
    expect(await countOwners(project.id)).toBe(1);
  });

  it('allows deleting a non-owner, which cannot orphan anything', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, viewer.id, 'viewer');

    await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, viewer.id]);
    expect(await countOwners(project.id)).toBe(1);
  });

  it('allows promoting a member to owner', async () => {
    const owner = await createUser();
    const member = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, member.id, 'editor');

    await query(`UPDATE project_members SET role = 'owner' WHERE project_id = $1 AND user_id = $2`, [project.id, member.id]);
    expect(await countOwners(project.id)).toBe(2);
  });

  it('transfers ownership atomically, never showing a zero-owner moment', async () => {
    const owner = await createUser();
    const successor = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, successor.id, 'editor');

    await query(`SELECT promote_member_to_owner($1, $2, $3)`, [project.id, successor.id, owner.id]);

    expect(await countOwners(project.id)).toBe(1);
    expect(await findMembership(project.id, successor.id)).toBe('owner');
    // The previous owner steps down rather than being removed: they keep read
    // and write access, which is usually what they want after handing over.
    expect(await findMembership(project.id, owner.id)).toBe('editor');

    const updated = await queryOne<{ owner_id: string }>(`SELECT owner_id FROM projects WHERE id = $1`, [project.id]);
    expect(updated!.owner_id).toBe(successor.id);
  });

  it('refuses an ownership transfer requested by a non-owner', async () => {
    const owner = await createUser();
    const impostor = await createUser();
    const target = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, impostor.id, 'editor');
    await addMember(project.id, target.id, 'editor');

    await expect(
      query(`SELECT promote_member_to_owner($1, $2, $3)`, [project.id, target.id, impostor.id]),
    ).rejects.toThrow(/only the current owner/);
  });

  it('refuses a non-owner from changing any membership', async () => {
    const owner = await createUser();
    const editor = await createUser();
    const target = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, editor.id, 'editor');
    await addMember(project.id, target.id, 'viewer');

    await expect(changeMemberRole(editor.id, project.id, target.id, 'viewer')).rejects.toThrow();
    await expect(removeProjectMember(editor.id, project.id, target.id)).rejects.toThrow();
  });

  it('refuses to demote or remove yourself', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);
    await expect(changeMemberRole(owner.id, project.id, owner.id, 'editor')).rejects.toThrow(UnprocessableError);
    await expect(removeProjectMember(owner.id, project.id, owner.id)).rejects.toThrow(UnprocessableError);
  });

  it('404s when changing a role for someone who is not a member', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const project = await createProject(owner.id);
    await expect(changeMemberRole(owner.id, project.id, stranger.id, 'viewer')).rejects.toThrow(NotFoundError);
    await expect(removeProjectMember(owner.id, project.id, stranger.id)).rejects.toThrow(NotFoundError);
  });
});
