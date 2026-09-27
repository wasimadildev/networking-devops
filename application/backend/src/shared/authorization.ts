import { ForbiddenError, NotFoundError } from './errors.js';
import type { Queryable } from '../db/pool.js';
import type { ProjectMemberRole } from '../modules/auth/types.js';
import { findMembership } from '../modules/projects/membership.repository.js';
import { findProjectById } from '../modules/projects/project.repository.js';

/**
 * Every authorisation decision in the app is made here.
 *
 * The rule this enforces: knowing an id is not permission. A task id in the URL
 * proves nothing, so each handler resolves the caller's role on the *enclosing
 * project* before it touches data. Centralising it means an audit of "who can do
 * what" is a read of this file rather than a grep across six services.
 *
 * A role hierarchy, not a set of booleans. `requireProjectRole(user, id, 'editor')`
 * is one comparison instead of a chain of "is owner or editor or…" clauses that
 * gets rewritten differently in every service.
 */
const ROLE_RANK: Record<ProjectMemberRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export const roleAtLeast = (actual: ProjectMemberRole, required: ProjectMemberRole): boolean =>
  ROLE_RANK[actual] >= ROLE_RANK[required];

export interface ProjectAccess {
  projectId: string;
  projectOwnerId: string;
  role: ProjectMemberRole;
}

/**
 * Resolves the caller's role on a project, or throws.
 *
 * `minRole` defaults to `viewer` because the safe default for a missing argument
 * is the least privileged role, not the most convenient one.
 */
export const requireProjectAccess = async (
  userId: string,
  projectId: string,
  minRole: ProjectMemberRole = 'viewer',
  client?: Queryable,
): Promise<ProjectAccess> => {
  const project = await findProjectById(projectId, client);
  if (!project) throw new NotFoundError('Project');

  const role = await findMembership(projectId, userId, client);

  // Not a member and the project does not exist produce the same 404. Returning
  // 403 for a project the caller cannot see would confirm it exists, which is a
  // slow enumeration oracle for a multi-tenant app.
  if (!role) throw new NotFoundError('Project');

  if (!roleAtLeast(role, minRole)) {
    throw new ForbiddenError(
      `This action requires the ${minRole} role in this project; you have ${role}`,
    );
  }

  return { projectId, projectOwnerId: project.ownerId, role };
};

/**
 * Convenience predicate for services that need to *branch* on a role rather than
 * gate on one — for example deciding whether to render an edit affordance.
 */
export const projectRoleOf = async (
  userId: string,
  projectId: string,
  client?: Queryable,
): Promise<ProjectMemberRole | null> => findMembership(projectId, userId, client);
