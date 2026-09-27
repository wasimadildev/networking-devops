import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { updateProfileBodySchema } from '../auth/auth.schemas.js';
import { meHandler, searchUsersHandler, updateMeHandler } from './user.controller.js';
import { userSearchQuerySchema } from './user.schemas.js';

export const userRouter = Router();

userRouter.use(authenticate);

userRouter.get('/users/me', meHandler);
userRouter.patch('/users/me', validate({ body: updateProfileBodySchema }), updateMeHandler);
userRouter.get('/users', validate({ query: userSearchQuerySchema }), searchUsersHandler);
