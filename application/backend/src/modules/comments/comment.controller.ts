import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { caller, param } from '../../shared/request.js';
import { validatedQuery } from '../../middleware/validate.js';
import { sendCreated, sendData, sendNoContent } from '../../shared/response.js';
import type { CreateCommentBody, ListCommentsQuery, UpdateCommentBody } from './comment.schemas.js';
import { createComment, getTaskComments, removeComment, updateComment } from './comment.service.js';

export const listCommentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const comments = await getTaskComments(
    caller(req).userId,
    param(req, 'taskId'),
    validatedQuery<ListCommentsQuery>(res),
  );
  sendData(res, comments);
});

export const createCommentHandler = asyncHandler(async (req: Request, res: Response) => {
  sendCreated(
    res,
    await createComment(caller(req).userId, param(req, 'taskId'), req.body as CreateCommentBody),
  );
});

export const updateCommentHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(
    res,
    await updateComment(caller(req).userId, param(req, 'commentId'), req.body as UpdateCommentBody),
  );
});

export const deleteCommentHandler = asyncHandler(async (req: Request, res: Response) => {
  await removeComment(caller(req).userId, param(req, 'commentId'));
  sendNoContent(res);
});
