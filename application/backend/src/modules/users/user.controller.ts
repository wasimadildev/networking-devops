import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { caller } from '../../shared/request.js';
import { validatedQuery } from '../../middleware/validate.js';
import { sendData } from '../../shared/response.js';
import { NotFoundError } from '../../shared/errors.js';
import type { UpdateProfileBody } from '../auth/auth.schemas.js';
import { updateProfile } from './user.service.js';
import { findUserById, searchUsers } from './user.repository.js';
import type { UserSearchQuery } from './user.schemas.js';

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUserById(caller(req).userId);
  if (!user) throw new NotFoundError('User');
  sendData(res, user);
});

export const updateMeHandler = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await updateProfile(caller(req).userId, req.body as UpdateProfileBody));
});

/**
 * Member picker. Scoped to people the caller already shares a project with —
 * the repository enforces it, not this handler, because a query that forgets the
 * scope leaks the whole directory and a forgotten filter is the usual way that
 * happens. An empty term returns the caller's existing colleagues rather than
 * every account, which is what makes this safe to call on focus.
 */
export const searchUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { search, limit } = validatedQuery<UserSearchQuery>(res);
  sendData(res, await searchUsers(caller(req).userId, search ?? '', limit));
});
