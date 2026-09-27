import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  commentIdParamSchema,
  createCommentBodySchema,
  listCommentsQuerySchema,
  taskCommentParamSchema,
  updateCommentBodySchema,
} from './comment.schemas.js';
import {
  createCommentHandler,
  deleteCommentHandler,
  listCommentsHandler,
  updateCommentHandler,
} from './comment.controller.js';

export const commentRouter = Router();

commentRouter.use(authenticate);

commentRouter.get(
  '/tasks/:taskId/comments',
  validate({ params: taskCommentParamSchema, query: listCommentsQuerySchema }),
  listCommentsHandler,
);

commentRouter.post(
  '/tasks/:taskId/comments',
  validate({ params: taskCommentParamSchema, body: createCommentBodySchema }),
  createCommentHandler,
);

commentRouter.patch(
  '/comments/:commentId',
  validate({ params: commentIdParamSchema, body: updateCommentBodySchema }),
  updateCommentHandler,
);

commentRouter.delete('/comments/:commentId', validate({ params: commentIdParamSchema }), deleteCommentHandler);
