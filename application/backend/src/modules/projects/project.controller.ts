import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { caller, param } from '../../shared/request.js';
import { validatedQuery } from '../../middleware/validate.js';
import { sendCreated, sendData, sendNoContent, sendPage } from '../../shared/response.js';
import { buildPage } from '../../shared/pagination.js';
import { listProjectActivity } from '../activity/activity.repository.js';
import type { PaginationQuery } from '../../shared/pagination.js';
import type {
  AddMemberBody,
  CreateProjectBody,
  ListMembersQuery,
  ListProjectsQuery,
  UpdateProjectBody,
} from './project.schemas.js';
import {
  addProjectMember,
  changeMemberRole,
  createProject,
  getMembers,
  getProject,
  listProjects,
  removeProjectMember,
  updateProject,
} from './project.service.js';

export const listProjectsHandler = asyncHandler(async (req: Request, res: Response) => {
  sendPage(res, await listProjects(caller(req).userId, validatedQuery<ListProjectsQuery>(res)));
});

export const createProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendCreated(res, await createProject(caller(req).userId, req.body as CreateProjectBody));
});

export const getProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await getProject(caller(req).userId, param(req, 'projectId')));
});

export const updateProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(
    res,
    await updateProject(caller(req).userId, param(req, 'projectId'), req.body as UpdateProjectBody),
  );
});

export const listMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  sendPage(
    res,
    await getMembers(caller(req).userId, param(req, 'projectId'), validatedQuery<ListMembersQuery>(res)),
  );
});

export const addMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  sendCreated(
    res,
    await addProjectMember(caller(req).userId, param(req, 'projectId'), req.body as AddMemberBody),
  );
});

export const changeMemberRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.body as { role: 'editor' | 'viewer' };
  const member = await changeMemberRole(
    caller(req).userId,
    param(req, 'projectId'),
    param(req, 'userId'),
    role,
  );
  sendData(res, member);
});

export const removeMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  await removeProjectMember(caller(req).userId, param(req, 'projectId'), param(req, 'userId'));
  sendNoContent(res);
});

export const activityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { rows, limit } = await listProjectActivity(
    caller(req).userId,
    param(req, 'projectId'),
    validatedQuery<PaginationQuery>(res),
  );
  sendPage(res, buildPage(rows, limit));
});
