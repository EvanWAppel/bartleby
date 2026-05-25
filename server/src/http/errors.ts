// Bartleby HTTP error model (S-012). Every 4xx/5xx response shape is
//
//   { "error": { "code": "<machine-readable>", "message": "<human>" } }
//
// Throw a BartlebyHttpError (or one of the typed subclasses) from a route
// handler and the central `errorHandler` middleware will serialize it.
// Unknown / unexpected errors are 500 + `{ error: { code: "internal" } }`
// with the original message swallowed (logged separately).

import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from 'pino';

export class BartlebyHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BartlebyHttpError';
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends BartlebyHttpError {
  constructor(resource: string, id: string) {
    super(404, 'not_found', `${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends BartlebyHttpError {
  constructor(message: string) {
    super(400, 'validation_failed', message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends BartlebyHttpError {
  constructor(message = 'forbidden') {
    super(403, 'forbidden', message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends BartlebyHttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
    this.name = 'ConflictError';
  }
}

export interface ErrorHandlerOptions {
  logger?: Logger;
}

/**
 * Hono error handler for the central error model. Pass via `app.onError`.
 * Unknown errors are logged (if a logger is provided) but never leak their
 * raw message — the response is a stable, sanitized 500.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  return (err, c) => {
    if (err instanceof BartlebyHttpError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status as ContentfulStatusCode,
      );
    }
    if (options.logger !== undefined) {
      options.logger.error({ err, path: c.req.path, method: c.req.method }, 'unhandled error');
    }
    return c.json({ error: { code: 'internal', message: 'internal server error' } }, 500);
  };
}
