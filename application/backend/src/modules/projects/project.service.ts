import { withTransaction, type Queryable } from '../../db/pool.js';
import { hasPgCode, PG_ERROR } from '../../db/pg-errors.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors.js';
import { buildPage, type Page } from '../../shared/pagination.js';
import { requireProjectAccess } from '../../shared/authorization.js';
import { childLogger } from '../../shared/logger.js';
import { logActivity } from '../activity/activity.repository.js';
import { findActiveUserByEmail } from '../users/user.repository.js';
import {
  addMember,
  countOwners,
  findMembership,
  listMembers,
  removeMember,
  updateMemberRole,
  type ProjectMember,
} from './membership.repository.js';
import {
  findProjectBySlug,
  findProjectWithViewerContext,
  insertProject,
  listProjectsForUser,
  updateProjectFields,
  type ProjectListItem,
  type ProjectRecord,
  type ProjectWithViewerContext,
} from './project.repository.js';
import type { AddMemberBody, CreateProjectBody, ListMembersQuery, ListProjectsQuery, UpdateProjectBody } from './project.schemas.js';

const log = childLogger('projects.service');

export interface ProjectDetail extends ProjectRecord {
  viewerRole: 'owner' | 'editor' | 'viewer';
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
}

/**
 * One place that turns a repository row into the API shape.
 *
 * Shared by the read and the update path so a field added to `ProjectDetail`
 * cannot appear in one response and be silently missing from the other. It also
 * owns the null-role rejection: `viewerRole: null` means the caller is not a
 * member, and a service must not be able to turn that into a successful read by
 * forgetting the check.
 */
const toProjectDetail = (row: ProjectWithViewerContext): ProjectDetail => {
  if (!row.viewerRole) throw new NotFoundError('Project');

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerId: row.ownerId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    viewerRole: row.viewerRole,
    memberCount: row.memberCount,
    taskCount: row.taskCount,
    openTaskCount: row.openTaskCount,
  };
};

export const listProjects = async (
  userId: string,
  query: ListProjectsQuery,
): Promise<Page<ProjectListItem>> => {
  const { rows, limit } = await listProjectsForUser(userId, query);
  return buildPage(rows, limit);
};

export const createProject = async (userId: string, body: CreateProjectBody): Promise<ProjectDetail> => {
  // Project, owner membership and audit row in one transaction. A project whose
  // creator is not a member is invisible and unopenable, so the membership
  // insert is not optional bookkeeping.
  return withTransaction(async (client) => {
    let project: ProjectRecord;
    try {
      project = await insertProject(
        { name: body.name, slug: body.slug, description: body.description ?? null, ownerId: userId },
        client,
      );
    } catch (error) {
      if (hasPgCode(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError('A project with that slug already exists');
      }
      throw error;
    }

    await addMember(project.id, userId, 'owner', client);
    await logActivity(
      { actorId: userId, projectId: project.id, entityType: 'project', entityId: project.id, action: 'project.created', metadata: { name: project.name, slug: project.slug } },
      client,
    );

    log.info({ projectId: project.id, ownerId: userId }, 'project created');

    return {
      ...project,
      viewerRole: 'owner',
      memberCount: 1,
      taskCount: 0,
      openTaskCount: 0,
    };
  });
};

export const getProject = async (userId: string, projectId: string): Promise<ProjectDetail> => {
  // Read access is itself a membership check — knowing the id gets you nothing.
  // The repository resolves role and counts in one query, so the 404 for a
  // non-member and the payload for a member come from the same statement.
  const project = await findProjectWithViewerContext(projectId, userId);
  if (!project) throw new NotFoundError('Project');

  return toProjectDetail(project);
};

export const updateProject = async (
  userId: string,
  projectId: string,
  body: UpdateProjectBody,
): Promise<ProjectDetail> => {
  // The resolved role is deliberately not captured. The call exists for the
  // membership check and the 403 it throws, and the viewer role is re-read with
  // the counts below rather than reused from a statement that ran before the
  // update.
  await requireProjectAccess(userId, projectId, 'editor');

  // Archiving is an owner-only action even though it arrives in the same body as
  // a rename. Checking it here is cheaper than splitting the route and keeps the
  // rule next to the other authorisation logic.
  if (body.status !== undefined) {
    await requireProjectAccess(userId, projectId, 'owner');
  }

  const updated = await updateProjectFields(projectId, body);
  if (!updated) throw new NotFoundError('Project');

  await logActivity({
    actorId: userId,
    projectId,
    entityType: 'project',
    entityId: projectId,
    action: body.status === 'archived' ? 'project.archived' : 'project.updated',
    metadata: { fields: Object.keys(body) },
  });

  // Re-read for the counts. Returning the `updated` row with memberCount/taskCount
  // hard-coded to 0 was a lie the client could not detect: a project with five
  // members reported zero after a rename. One extra read of a single row by
  // primary key is cheap next to returning a field that is wrong.
  const detail = await findProjectWithViewerContext(projectId, userId);
  if (!detail) throw new NotFoundError('Project');

  return toProjectDetail(detail);
};

export const addProjectMember = async (
  userId: string,
  projectId: string,
  body: AddMemberBody,
): Promise<{ userId: string; role: string }> => {
  await requireProjectAccess(userId, projectId, 'owner');

  // The email is resolved here rather than accepted as an id from the client, so
  // the app never needs a browsable user directory. A miss is a plain 404: the
  // caller is already a project owner, so the residual ability to test one
  // address is a much smaller disclosure than the directory it replaces.
  const invitee = await findActiveUserByEmail(body.email);
  if (!invitee) throw new NotFoundError('No account with that email address');

  return withTransaction(async (client: Queryable) => {
    try {
      const member = await addMember(projectId, invitee.id, body.role, client);
      if (!member) throw new Error('member upsert returned no row');

      await logActivity(
        {
          actorId: userId,
          projectId,
          entityType: 'project_member',
          entityId: invitee.id,
          action: 'project.member_added',
          metadata: { role: body.role },
        },
        client,
      );

      log.info({ projectId, memberId: invitee.id, role: body.role }, 'member added');
      return { userId: member.userId, role: member.role };
    } catch (error) {
      if (hasPgCode(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError('That user is already a member of this project');
      }
      throw error;
    }
  });
};

export const changeMemberRole = async (
  userId: string,
  projectId: string,
  targetUserId: string,
  role: 'editor' | 'viewer',
): Promise<{ userId: string; role: string }> => {
  await requireProjectAccess(userId, projectId, 'owner');

  if (targetUserId === userId) {
    throw new UnprocessableError('You cannot change your own role');
  }

  return withTransaction(async (client) => {
    // The guard reads the role the target holds *before* the update. An earlier
    // version updated first and then compared the returned role against 'owner',
    // which by construction could never match — the guard was decoration, and
    // the only thing actually preventing an ownerless project was the
    // "cannot change your own role" check above.
    const currentRole = await findMembership(projectId, targetUserId, client);
    if (!currentRole) throw new NotFoundError('Project member');

    if (currentRole === 'owner' && (await countOwners(projectId, client)) <= 1) {
      throw new UnprocessableError('A project must keep at least one owner');
    }

    const target = await updateMemberRole(projectId, targetUserId, role, client);
    if (!target) throw new NotFoundError('Project member');

    await logActivity(
      {
        actorId: userId,
        projectId,
        entityType: 'project_member',
        entityId: targetUserId,
        action: 'project.member_role_changed',
        metadata: { newRole: role },
      },
      client,
    );

    log.info({ projectId, memberId: targetUserId, role }, 'member role changed');
    return { userId: target.userId, role: target.role };
  });
};

export const removeProjectMember = async (
  userId: string,
  projectId: string,
  targetUserId: string,
): Promise<{ removed: true }> => {
  await requireProjectAccess(userId, projectId, 'owner');

  if (targetUserId === userId) {
    throw new UnprocessableError('You cannot remove yourself; transfer ownership first');
  }

  return withTransaction(async (client) => {
    // Pre-update role, same reason as changeMemberRole. This path used to
    // "demote to viewer" first purely to read the role back, which wrote a row
    // that the following DELETE discarded, and then compared the post-update
    // role to 'owner' — a comparison that could never be true.
    const currentRole = await findMembership(projectId, targetUserId, client);
    if (!currentRole) throw new NotFoundError('Project member');

    if (currentRole === 'owner' && (await countOwners(projectId, client)) <= 1) {
      throw new UnprocessableError('A project must keep at least one owner');
    }

    const removed = await removeMember(projectId, targetUserId, client);
    if (!removed) throw new NotFoundError('Project member');

    await logActivity(
      {
        actorId: userId,
        projectId,
        entityType: 'project_member',
        entityId: targetUserId,
        action: 'project.member_removed',
        metadata: {},
      },
      client,
    );

    log.info({ projectId, memberId: targetUserId }, 'member removed');
    return { removed: true as const };
  });
};

export const getMembers = async (
  userId: string,
  projectId: string,
  query: ListMembersQuery,
): Promise<Page<ProjectMember>> => {
  await requireProjectAccess(userId, projectId, 'viewer');
  return listMembers(projectId, query);
};

/** Slug uniqueness pre-check. The unique index remains the real guarantee. */
export const assertSlugAvailable = async (slug: string): Promise<void> => {
  const existing = await findProjectBySlug(slug);
  if (existing) throw new ConflictError('A project with that slug already exists');
};
