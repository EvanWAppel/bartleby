// C-007: Comments REST CRUD.
//
// POST   /notes/:id/comments        create top-level comment
// GET    /notes/:id/comments        list (open by default)
// POST   /comments/:id/replies      reply to a comment
// PATCH  /comments/:id/resolve      set resolved_at
// PATCH  /comments/:id/reopen       clear resolved_at
// DELETE /comments/:id              delete row
//
// Auth gating lives in http.ts (requireSession). Tests use a stub user
// the same way the notes routes do.

import { describe, expect } from 'vitest';
import { Hono } from 'hono';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { errorHandler } from '../http/errors.js';
import type { AuthVars, User } from '../auth/index.js';
import { createCommentsApp } from './routes.js';
import { createNotesApp } from '../notes/routes.js';
import { test as base } from 'vitest';
import type { Database } from 'better-sqlite3';

const FIXED_NOW = new Date('2026-06-21T12:00:00Z');
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

const TEST_USER: User = {
  id: 'u-test-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#ff0080',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

interface CommentsFixture {
  db: Database;
  app: Hono<{ Variables: AuthVars }>;
  noteId: string;
}

function buildApp(db: Database): { app: Hono<{ Variables: AuthVars }>; noteId: string } {
  const repos = createRepositories(db);
  const app = new Hono<{ Variables: AuthVars }>();
  app.onError(errorHandler());
  app.use('*', async (c, next) => {
    c.set('user', TEST_USER);
    await next();
  });
  // Mount notes so we can create a note to comment on.
  app.route('/', createNotesApp({ repos, now: () => FIXED_NOW }));
  app.route('/', createCommentsApp({ repos, now: () => FIXED_NOW }));
  return { app, noteId: '' };
}

const test = base.extend<CommentsFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  app: async ({ db }, use) => {
    const { app } = buildApp(db);
    await use(app);
  },
  noteId: async ({ db }, use) => {
    const { app } = buildApp(db);
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host note' }),
    });
    const body = (await res.json()) as { id: string };
    await use(body.id);
  },
});

interface CommentDto {
  id: string;
  note_id: string;
  author_id: string;
  parent_comment_id: string | null;
  anchor: string;
  original_quote: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

describe('POST /notes/:id/comments (C-007)', () => {
  test('creates a top-level comment and returns the row', async ({ db }) => {
    const { app, noteId } = await (async () => {
      const built = buildApp(db);
      const noteRes = await built.app.request('/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'host' }),
      });
      const noteBody = (await noteRes.json()) as { id: string };
      return { ...built, noteId: noteBody.id };
    })();
    const res = await app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        anchor: '{"head":[1,2],"anchor":[3,4]}',
        original_quote: 'quoted text',
        body: 'this is a comment',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CommentDto;
    expect(body.note_id).toBe(noteId);
    expect(body.author_id).toBe(TEST_USER.id);
    expect(body.parent_comment_id).toBeNull();
    expect(body.anchor).toBe('{"head":[1,2],"anchor":[3,4]}');
    expect(body.original_quote).toBe('quoted text');
    expect(body.body).toBe('this is a comment');
    expect(body.created_at).toBe(FIXED_NOW_ISO);
    expect(body.resolved_at).toBeNull();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('404 when the note does not exist', async ({ app }) => {
    const res = await app.request('/notes/no-such-id/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'hi' }),
    });
    expect(res.status).toBe(404);
  });

  test('400 when body is missing', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteBody = (await noteRes.json()) as { id: string };
    const res = await built.app.request(`/notes/${noteBody.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '' }),
    });
    expect(res.status).toBe(400);
  });

  test('400 when body is whitespace-only', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteBody = (await noteRes.json()) as { id: string };
    const res = await built.app.request(`/notes/${noteBody.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /notes/:id/comments (C-007)', () => {
  test('lists comments (open by default) including replies', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteBody = (await noteRes.json()) as { id: string };
    const noteId = noteBody.id;

    // Create two top-level comments + one reply.
    const c1Res = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: 'a1', original_quote: '', body: 'first' }),
    });
    const c1 = (await c1Res.json()) as CommentDto;
    await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: 'a2', original_quote: '', body: 'second' }),
    });
    await built.app.request(`/comments/${c1.id}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'reply to first' }),
    });

    const res = await built.app.request(`/notes/${noteId}/comments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comments: CommentDto[] };
    expect(body.comments).toHaveLength(3);
    const reply = body.comments.find((c) => c.body === 'reply to first');
    expect(reply?.parent_comment_id).toBe(c1.id);
  });

  test('omits resolved comments by default; ?include=resolved returns them', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;

    const cRes = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'to be resolved' }),
    });
    const c = (await cRes.json()) as CommentDto;
    await built.app.request(`/comments/${c.id}/resolve`, { method: 'PATCH' });

    const openRes = await built.app.request(`/notes/${noteId}/comments`);
    expect(((await openRes.json()) as { comments: CommentDto[] }).comments).toHaveLength(0);

    const allRes = await built.app.request(`/notes/${noteId}/comments?include=resolved`);
    const all = (await allRes.json()) as { comments: CommentDto[] };
    expect(all.comments).toHaveLength(1);
    expect(all.comments[0]?.resolved_at).toBe(FIXED_NOW_ISO);
  });

  test('404 when the note does not exist', async ({ app }) => {
    const res = await app.request('/notes/no-such-id/comments');
    expect(res.status).toBe(404);
  });
});

describe('POST /comments/:id/replies (C-007)', () => {
  test('creates a reply with parent_comment_id set', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    const cRes = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'top' }),
    });
    const c = (await cRes.json()) as CommentDto;
    const replyRes = await built.app.request(`/comments/${c.id}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'reply!' }),
    });
    expect(replyRes.status).toBe(201);
    const reply = (await replyRes.json()) as CommentDto;
    expect(reply.parent_comment_id).toBe(c.id);
    expect(reply.note_id).toBe(noteId);
    expect(reply.body).toBe('reply!');
  });

  test('404 when the parent comment does not exist', async ({ app }) => {
    const res = await app.request('/comments/no-such-comment/replies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'orphan' }),
    });
    expect(res.status).toBe(404);
  });

  test('400 when reply body is missing', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    const cRes = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'top' }),
    });
    const c = (await cRes.json()) as CommentDto;
    const res = await built.app.request(`/comments/${c.id}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /comments/:id/resolve + /reopen (C-007)', () => {
  test('resolve sets resolved_at; reopen clears it', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    const cRes = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'todo' }),
    });
    const c = (await cRes.json()) as CommentDto;

    const resolveRes = await built.app.request(`/comments/${c.id}/resolve`, { method: 'PATCH' });
    expect(resolveRes.status).toBe(200);
    expect(((await resolveRes.json()) as CommentDto).resolved_at).toBe(FIXED_NOW_ISO);

    const reopenRes = await built.app.request(`/comments/${c.id}/reopen`, { method: 'PATCH' });
    expect(reopenRes.status).toBe(200);
    expect(((await reopenRes.json()) as CommentDto).resolved_at).toBeNull();
  });

  test('404 when the comment does not exist', async ({ app }) => {
    const r = await app.request('/comments/no-such/resolve', { method: 'PATCH' });
    expect(r.status).toBe(404);
    const r2 = await app.request('/comments/no-such/reopen', { method: 'PATCH' });
    expect(r2.status).toBe(404);
  });
});

describe('DELETE /comments/:id (C-007)', () => {
  test('removes the row', async ({ db }) => {
    const built = buildApp(db);
    const noteRes = await built.app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    const cRes = await built.app.request(`/notes/${noteId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: '', original_quote: '', body: 'doomed' }),
    });
    const c = (await cRes.json()) as CommentDto;

    const delRes = await built.app.request(`/comments/${c.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const listRes = await built.app.request(`/notes/${noteId}/comments`);
    expect(((await listRes.json()) as { comments: CommentDto[] }).comments).toHaveLength(0);
  });

  test('404 when the comment does not exist', async ({ app }) => {
    const res = await app.request('/comments/no-such', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
