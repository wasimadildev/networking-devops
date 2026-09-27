import express, { type Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProduction } from './config/app-env.js';
import { logger } from './shared/logger.js';
import { NotFoundError } from './shared/errors.js';
import { requestContext } from './middleware/request-context.js';
import { apiRateLimiter } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { projectRouter } from './modules/projects/project.routes.js';
import { taskRouter } from './modules/tasks/task.routes.js';
import { commentRouter } from './modules/comments/comment.routes.js';

/**
 * Builds the app. Kept separate from server.ts so tests can mount the same
 * instance with Supertest and get an identical middleware chain — a test that
 * builds its own app is a test of a different program.
 */
export const createApp = (): Express => {
  const app = express();

  // Behind Application Gateway or an ingress, one hop is added. `1` is not a
  // guess: trust-everything (`true`) lets any client spoof X-Forwarded-For and
  // poison the rate limiter, while trusting nothing makes req.ip the proxy's
  // address and rate-limits the whole internet as one client.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  // Must run before pinoHttp so the request id exists on the log line.
  app.use(requestContext);

  app.use(
    helmet({
      // This API returns JSON only, never HTML, so a CSP would be inert. Left
      // unset deliberately rather than set to a meaningless value.
      contentSecurityPolicy: false,
      // Required for the load balancer health probe to read a body if it ever
      // needs to, and harmless for a JSON API.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      // An explicit allowlist. `origin: true` would reflect whatever the client
      // sends, which combined with credentials in localStorage is an open door.
      origin: env.CORS_ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
      // Never log the body. A login request contains a password, and a log
      // collector is a wider blast radius than the app itself.
      // Typed explicitly: pino-http's serializer parameters are `any`, and an
      // untyped `req.id` here would silently compile if the field were renamed.
      serializers: {
        req: (req: IncomingMessage & { id?: number }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Health probes are noise in the access log; the readiness check is what
      // matters, and it logs its own outcome.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/health/ready' },
    }),
  );

  // A small body cap. A task description is 4000 characters; anything far larger
  // is a mistake or an attempt to exhaust memory.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use('/api/v1', apiRateLimiter);

  // Health is mounted before the rate limiter's own handler skips it, and before
  // any authentication, so a probe never needs a credential.
  app.use(healthRouter);

  app.get('/api/v1', (_req, res) => {
    res.json({
      data: {
        name: 'TaskFlow API',
        version: '1.0.0',
        docs: '/api/v1/docs',
      },
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', userRouter);
  app.use('/api/v1', projectRouter);
  app.use('/api/v1', taskRouter);
  app.use('/api/v1', commentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler());

  if (!isProduction) {
    app.locals['logger'] = logger;
  }

  return app;
};

export { NotFoundError };
