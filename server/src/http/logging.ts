// Request logging middleware (S-013). Emits one structured log per
// request with method, path, status, duration, and (when available)
// the authenticated user's id.
//
// Stacks UNDER the auth middleware in the pipeline so `userId` is set
// before this middleware runs; for anonymous routes it's simply omitted.

import type { MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';
import type { AuthVars } from '../auth/index.js';

export function requestLogger(logger: Logger): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const startedAt = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - startedAt);

    const user = c.get('user');
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
        ...(user !== undefined ? { userId: user.id } : {}),
      },
      'request',
    );
  };
}
