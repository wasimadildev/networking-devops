import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  createTaskBodySchema,
  listTasksQuerySchema,
  moveTaskBodySchema,
  projectTaskParamSchema,
  taskIdParamSchema,
  updateTaskBodySchema,
} from './task.schemas.js';
import {
  boardHandler,
  createTaskHandler,
  deleteTaskHandler,
  getTaskHandler,
  listTasksHandler,
  moveTaskHandler,
  updateTaskHandler,
} from './task.controller.js';

export const taskRouter = Router();

taskRouter.use(authenticate);

/**
 * Task routes are mounted twice: nested under a project and flat by id. The flat
 * routes still resolve the project from the task and authorise against it, so
 * mounting them at two paths does not create two authorisation policies.
 */
taskRouter.get('/tasks/:taskId', validate({ params: taskIdParamSchema }), getTaskHandler);
taskRouter.patch('/tasks/:taskId', validate({ params: taskIdParamSchema, body: updateTaskBodySchema }), updateTaskHandler);
taskRouter.post('/tasks/:taskId/move', validate({ params: taskIdParamSchema, body: moveTaskBodySchema }), moveTaskHandler);
taskRouter.delete('/tasks/:taskId', validate({ params: taskIdParamSchema }), deleteTaskHandler);

taskRouter.get(
  '/projects/:projectId/board',
  validate({ params: projectTaskParamSchema }),
  boardHandler,
);

taskRouter.get(
  '/projects/:projectId/tasks',
  validate({ params: projectTaskParamSchema, query: listTasksQuerySchema }),
  listTasksHandler,
);

taskRouter.post(
  '/projects/:projectId/tasks',
  validate({ params: projectTaskParamSchema, body: createTaskBodySchema }),
  createTaskHandler,
);
