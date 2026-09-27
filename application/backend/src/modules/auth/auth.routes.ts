import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  changePasswordBodySchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
} from './auth.schemas.js';
import {
  changePasswordHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  refreshHandler,
  registerHandler,
} from './auth.controller.js';

export const authRouter = Router();

/**
 * The auth router carries the strict limiter; the global limiter in app.ts is the
 * coarse one for everything else. Credential endpoints are the ones worth
 * attacking, so they get their own budget.
 */
authRouter.post('/register', authRateLimiter, validate({ body: registerBodySchema }), registerHandler);
authRouter.post('/login', authRateLimiter, validate({ body: loginBodySchema }), loginHandler);
authRouter.post('/refresh', authRateLimiter, validate({ body: refreshBodySchema }), refreshHandler);
authRouter.post('/logout', validate({ body: refreshBodySchema }), logoutHandler);

authRouter.post('/logout-all', authenticate, logoutAllHandler);
authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordBodySchema }),
  changePasswordHandler,
);
