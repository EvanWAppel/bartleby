import { describe, expect } from 'vitest';
import { buildTestNotesApp, notesTest as test, TEST_USER } from './test-helpers.js';

const FIXED_NOW = new Date('2026-06-01T12:00:00Z');
const fixedNow = () => FIXED_NOW;

describe('POST /notes (S-001)', () => {
  test('creates an empty note with a uuid and the given title', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My first note' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; title: string };
    expect(body.title).toBe('My first note');
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const row = repos.notes.findById(body.id);
    expect(row).toMatchObject({
      title: 'My first note',
      created_by: TEST_USER.id,
      created_at: FIXED_NOW.toISOString(),
      updated_at: FIXED_NOW.toISOString(),
      trashed_at: null,
      markdown_export: '',
    });
  });

  test('defaults the title to "Untitled" when missing or empty', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { now: fixedNow });
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; title: string };
    expect(body.title).toBe('Untitled');
  });

  test('appends the initial title to note_titles_history', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Trip' }),
    });
    const { id } = (await res.json()) as { id: string };
    const history = repos.noteTitlesHistory.listByNote(id);
    expect(history).toHaveLength(1);
    expect(history[0]?.title).toBe('Trip');
  });

  test('rejects with 400 when the request body is not JSON', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  test('rejects with 400 when title is not a string', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 123 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /notes (S-002)', () => {
  test('returns id/title/tags/updated_at for live notes, newest first', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r1 = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'older' }),
    });
    const { id: id1 } = (await r1.json()) as { id: string };
    // Advance the clock so the second note has a later updated_at.
    const { app: app2 } = buildTestNotesApp(db, {
      now: () => new Date('2026-06-01T13:00:00Z'),
    });
    const r2 = await app2.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'newer' }),
    });
    const { id: id2 } = (await r2.json()) as { id: string };
    repos.tags.replaceForNote(id1, ['travel']);

    const res = await app.request('/notes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: { id: string; title: string; tags: string[]; updated_at: string }[];
    };
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0]?.title).toBe('newer');
    expect(body.notes[0]?.id).toBe(id2);
    expect(body.notes[1]?.title).toBe('older');
    expect(body.notes[1]?.tags).toEqual(['travel']);
  });

  test('omits trashed notes', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'doomed' }),
    });
    const { id } = (await r.json()) as { id: string };
    repos.notes.softDelete(id, FIXED_NOW.toISOString());

    const res = await app.request('/notes');
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  test('filters by ?tag=', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const a = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A' }),
    });
    const b = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'B' }),
    });
    const idA = ((await a.json()) as { id: string }).id;
    const idB = ((await b.json()) as { id: string }).id;
    repos.tags.replaceForNote(idA, ['travel']);
    repos.tags.replaceForNote(idB, ['cooking']);

    const res = await app.request('/notes?tag=travel');
    const body = (await res.json()) as { notes: { id: string }[] };
    expect(body.notes.map((n) => n.id)).toEqual([idA]);
  });

  test('filters by ?q= (FTS over markdown_export)', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const a = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Recipe' }),
    });
    const b = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Trip' }),
    });
    const idA = ((await a.json()) as { id: string }).id;
    const idB = ((await b.json()) as { id: string }).id;
    repos.notes.updateMarkdownExport(idA, 'Risotto with mushrooms', FIXED_NOW.toISOString());
    repos.notes.updateMarkdownExport(idB, 'Madrid food list', FIXED_NOW.toISOString());

    const res = await app.request('/notes?q=mushrooms');
    const body = (await res.json()) as { notes: { id: string }[] };
    expect(body.notes.map((n) => n.id)).toEqual([idA]);
    // The other one isn't returned.
    expect(body.notes.map((n) => n.id)).not.toContain(idB);
  });
});

describe('GET /notes/trash (S-003)', () => {
  test('returns only trashed notes', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const live = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'live' }),
    });
    const trashed = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'trashed' }),
    });
    const idLive = ((await live.json()) as { id: string }).id;
    const idTrashed = ((await trashed.json()) as { id: string }).id;
    repos.notes.softDelete(idTrashed, FIXED_NOW.toISOString());

    const res = await app.request('/notes/trash');
    const body = (await res.json()) as { notes: { id: string }[] };
    expect(body.notes.map((n) => n.id)).toEqual([idTrashed]);
    expect(body.notes.map((n) => n.id)).not.toContain(idLive);
  });
});

describe('PATCH /notes/:id (S-004)', () => {
  test('updates the title and appends to history; bumps updated_at', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'first' }),
    });
    const { id } = (await r.json()) as { id: string };

    const later = new Date('2026-06-02T09:00:00Z');
    const { app: app2 } = buildTestNotesApp(db, { now: () => later });
    const res = await app2.request(`/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'renamed' }),
    });
    expect(res.status).toBe(200);

    const row = repos.notes.findById(id);
    expect(row?.title).toBe('renamed');
    expect(row?.updated_at).toBe(later.toISOString());

    const history = repos.noteTitlesHistory.listByNote(id);
    expect(history.map((h) => h.title)).toEqual(['first', 'renamed']);
  });

  test('replaces tags atomically', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    const { id } = (await r.json()) as { id: string };
    repos.tags.replaceForNote(id, ['old']);

    const res = await app.request(`/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['new', 'fresh'] }),
    });
    expect(res.status).toBe(200);
    expect(repos.tags.listForNote(id).sort()).toEqual(['fresh', 'new']);
  });

  test('a no-op PATCH (no title, no tags) returns 200 and changes nothing', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'stable' }),
    });
    const { id } = (await r.json()) as { id: string };
    const before = repos.notes.findById(id);

    const res = await app.request(`/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(repos.notes.findById(id)).toEqual(before);
  });

  test('404 on unknown id', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/nonexistent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /notes/:id (S-005) + POST /notes/:id/restore (S-006)', () => {
  test('soft-deletes then restores', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const r = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'to-be-deleted' }),
    });
    const { id } = (await r.json()) as { id: string };

    const del = await app.request(`/notes/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(repos.notes.findById(id)?.trashed_at).toBe(FIXED_NOW.toISOString());

    const list = await app.request('/notes');
    expect(((await list.json()) as { notes: unknown[] }).notes).toEqual([]);
    const trash = await app.request('/notes/trash');
    expect(((await trash.json()) as { notes: { id: string }[] }).notes[0]?.id).toBe(id);

    const restore = await app.request(`/notes/${id}/restore`, { method: 'POST' });
    expect(restore.status).toBe(204);
    expect(repos.notes.findById(id)?.trashed_at).toBeNull();
  });

  test('DELETE 404 on unknown id', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('POST restore 404 on unknown id', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/missing/restore', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('auth gating', () => {
  test('every route 401s when no session is set', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { user: null });
    for (const [method, path] of [
      ['POST', '/notes'],
      ['GET', '/notes'],
      ['GET', '/notes/trash'],
      ['PATCH', '/notes/x'],
      ['DELETE', '/notes/x'],
      ['POST', '/notes/x/restore'],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
