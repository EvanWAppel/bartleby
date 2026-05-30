// Per-test plumbing for notes routes: an in-memory DB with migrations
// applied, repos on top, a stubbed `requireSession` that injects a fake
// session user, and the notes app mounted on a hono root.
//
// We deliberately don't pull in the real OAuth/session machinery here;
// auth correctness is exercised in src/auth/*.test.ts. These tests only
// care about route logic given an authenticated user.

import type { Database } from 'better-sqlite3';
import { Hono } from 'hono';
import { test as base } from 'vitest';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories, type Repositories } from '../db/repositories/index.js';
import type { User, AuthVars } from '../auth/index.js';
import { errorHandler } from '../http/errors.js';
import { createNotesApp, type NotesAppDeps } from './routes.js';
import { createSearchApp } from './search-route.js';

export const TEST_USER: User = {
  id: 'u-test-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#ff0080',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

export interface NotesTestFixture {
  db: Database;
  repos: Repositories;
  app: Hono<{ Variables: AuthVars }>;
}

export interface BuildNotesAppOptions {
  user?: User | null;
  now?: NotesAppDeps['now'];
}

export function buildTestNotesApp(
  db: Database,
  options: BuildNotesAppOptions = {},
): { repos: Repositories; app: Hono<{ Variables: AuthVars }> } {
  const repos = createRepositories(db);
  const user = options.user === undefined ? TEST_USER : options.user;

  const app = new Hono<{ Variables: AuthVars }>();
  app.onError(errorHandler());
  // Stub auth: every request gets the configured user (or 401 if null).
  app.use('*', async (c, next) => {
    if (user === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'no session' } }, 401);
    }
    c.set('user', user);
    await next();
  });
  const notes = createNotesApp({ repos, now: options.now });
  app.route('/', notes);
  const search = createSearchApp({ repos });
  app.route('/', search);
  return { repos, app };
}

export const notesTest = base.extend<NotesTestFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  repos: async ({ db }, use) => {
    await use(createRepositories(db));
  },
  app: async ({ db }, use) => {
    const { app } = buildTestNotesApp(db);
    await use(app);
  },
});
