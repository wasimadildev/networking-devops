import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  addMemberBodySchema,
  createProjectBodySchema,
  listMembersQuerySchema,
  listProjectsQuerySchema,
  memberIdParamSchema,
  projectIdParamSchema,
  updateProjectBodySchema,
} from './project.schemas.js';
import {
  activityHandler,
  addMemberHandler,
  changeMemberRoleHandler,
  createProjectHandler,
  getProjectHandler,
  listMembersHandler,
  listProjectsHandler,
  removeMemberHandler,
  updateProjectHandler,
} from './project.controller.js';

export const projectRouter = Router();

projectRouter.use(authenticate);

projectRouter.get('/projects', validate({ query: listProjectsQuerySchema }), listProjectsHandler);
projectRouter.post('/projects', validate({ body: createProjectBodySchema }), createProjectHandler);

projectRouter.get('/projects/:projectId', validate({ params: projectIdParamSchema }), getProjectHandler);
projectRouter.patch(
  '/projects/:projectId',
  validate({ params: projectIdParamSchema, body: updateProjectBodySchema }),
  updateProjectHandler,
);

projectRouter.get(
  '/projects/:projectId/members',
  validate({ params: projectIdParamSchema, query: listMembersQuerySchema }),
  listMembersHandler,
);

projectRouter.post(
  '/projects/:projectId/members',
  validate({ params: projectIdParamSchema, body: addMemberBodySchema }),
  addMemberHandler,
);

projectRouter.patch(
  '/projects/:projectId/members/:userId',
  validate({ params: memberIdParamSchema, body: addMemberBodySchema.pick({ role: true }) }),
  changeMemberRoleHandler,
);

projectRouter.delete(
  '/projects/:projectId/members/:userId',
  validate({ params: memberIdParamSchema }),
  removeMemberHandler,
);

projectRouter.get(
  '/projects/:projectId/activity',
  validate({ params: projectIdParamSchema, query: listProjectsQuerySchema.pick({ limit: true, cursor: true }) }),
  activityHandler,
);
