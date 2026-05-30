// GET /search?q=... (S-011). FTS5 over notes.markdown_export via D's
// search repository. Trashed notes are excluded inside the repository.

import { Hono } from 'hono';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import { ValidationError } from '../http/errors.js';

export interface SearchAppDeps {
  repos: Repositories;
}

export function createSearchApp(deps: SearchAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  app.get('/search', (c) => {
    const q = c.req.query('q');
    if (q === undefined || q.length === 0) {
      throw new ValidationError('q query param is required');
    }
    const limitStr = c.req.query('limit');
    const limit = limitStr === undefined ? undefined : Number(limitStr);
    const hits = repos.search.searchNotes(q, limit !== undefined ? { limit } : undefined);
    return c.json({ hits });
  });

  return app;
}
