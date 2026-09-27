import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { caller, param } from '../../shared/request.js';
import { validatedQuery } from '../../middleware/validate.js';
import { sendCreated, sendData, sendNoContent, sendPage } from '../../shared/response.js';
import type { CreateTaskBody, ListTasksQuery, MoveTaskBody, UpdateTaskBody } from './task.schemas.js';
import {
  createTask,
  getProjectBoard,
  getTask,
  listProjectTasks,
  moveTask,
  removeTask,
  updateTask,
} from './task.service.js';

export const listTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const page = await listProjectTasks(
    caller(req).userId,
    param(req, 'projectId'),
    validatedQuery<ListTasksQuery>(res),
  );
  sendPage(res, page);
});

export const boardHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await getProjectBoard(caller(req).userId, param(req, 'projectId')));
});

export const getTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await getTask(caller(req).userId, param(req, 'taskId')));
});

export const createTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  sendCreated(
    res,
    await createTask(caller(req).userId, param(req, 'projectId'), req.body as CreateTaskBody),
  );
});

export const updateTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await updateTask(caller(req).userId, param(req, 'taskId'), req.body as UpdateTaskBody));
});

export const moveTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await moveTask(caller(req).userId, param(req, 'taskId'), req.body as MoveTaskBody));
});

export const deleteTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  await removeTask(caller(req).userId, param(req, 'taskId'));
  sendNoContent(res);
});
