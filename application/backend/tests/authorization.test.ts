import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { roleAtLeast, requireProjectAccess } from '../src/shared/authorization.js';
import { ForbiddenError, NotFoundError } from '../src/shared/errors.js';
import { addMember, closeDatabase, createProject, createUser, truncateAll } from './helpers.js';

beforeEach(truncateAll);
afterAll(closeDatabase);

describe('roleAtLeast', () => {
  it('grants the same role', () => {
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });

  it('grants a higher role to a lower requirement', () => {
    expect(roleAtLeast('editor', 'viewer')).toBe(true);
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
    expect(roleAtLeast('owner', 'editor')).toBe(true);
  });

  it('refuses a lower role against a higher requirement', () => {
    expect(roleAtLeast('viewer', 'editor')).toBe(false);
    expect(roleAtLeast('viewer', 'owner')).toBe(false);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
  });
});

describe('requireProjectAccess', () => {
  it('returns the caller role for a member', async () => {
    const owner = await createUser();
    const editor = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, editor.id, 'editor');

    const access = await requireProjectAccess(editor.id, project.id, 'viewer');
    expect(access.role).toBe('editor');
    expect(access.projectId).toBe(project.id);
    expect(access.projectOwnerId).toBe(owner.id);
  });

  it('gives a non-member a 404, not a 403', async () => {
    // 403 would confirm the project exists, which is an enumeration oracle.
    const owner = await createUser();
    const stranger = await createUser();
    const project = await createProject(owner.id);

    await expect(requireProjectAccess(stranger.id, project.id)).rejects.toThrow(NotFoundError);
  });

  it('gives a non-member the same 404 for a project that does not exist', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const project = await createProject(owner.id);

    const existing = await requireProjectAccess(stranger.id, project.id).catch((e: Error) => e);
    const missing = await requireProjectAccess(stranger.id, '00000000-0000-4000-8000-000000000000').catch((e: Error) => e);

    expect(existing).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    // The status and code must match, or the 404 becomes a 500-vs-404 oracle.
    expect((existing as NotFoundError).statusCode).toBe((missing as NotFoundError).statusCode);
    expect((existing as NotFoundError).code).toBe((missing as NotFoundError).code);
  });

  it('refuses a member below the required role', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, viewer.id, 'viewer');

    await expect(requireProjectAccess(viewer.id, project.id, 'editor')).rejects.toThrow(ForbiddenError);
  });

  it('refuses a viewer acting as an owner', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, viewer.id, 'viewer');

    await expect(requireProjectAccess(viewer.id, project.id, 'owner')).rejects.toThrow(ForbiddenError);
  });

  it('refuses a non-member even when the required role is viewer', async () => {
    // The default is viewer, not editor or owner: a missing argument must fail
    // closed, not open.
    const owner = await createUser();
    const stranger = await createUser();
    const project = await createProject(owner.id);

    await expect(requireProjectAccess(stranger.id, project.id)).rejects.toThrow(NotFoundError);
  });

  it('lets an owner do anything an owner can do', async () => {
    const owner = await createUser();
    const project = await createProject(owner.id);

    const access = await requireProjectAccess(owner.id, project.id, 'owner');
    expect(access.role).toBe('owner');
  });

  it('names both roles in the 403 so the client can explain the refusal', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const project = await createProject(owner.id);
    await addMember(project.id, viewer.id, 'viewer');

    const error = await requireProjectAccess(viewer.id, project.id, 'editor').catch((e: Error) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toContain('editor');
    expect((error as Error).message).toContain('viewer');
  });
});
