// S-007 + S-008 + S-011: read-side endpoints that surface what the
// Yjs change hook (S-009) populates downstream — backlinks table,
// note_titles_history table, FTS5 index.

import { describe, expect } from 'vitest';
import { buildTestNotesApp, notesTest as test } from './test-helpers.js';

const FIXED_NOW = new Date('2026-06-01T12:00:00Z');
const fixedNow = () => FIXED_NOW;

async function createNote(
  app: ReturnType<typeof buildTestNotesApp>['app'],
  title: string,
): Promise<string> {
  const res = await app.request('/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return ((await res.json()) as { id: string }).id;
}

describe('GET /notes/:id/backlinks (S-007)', () => {
  test('returns inbound links with source title + link_text', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const idA = await createNote(app, 'A');
    const idB = await createNote(app, 'B');
    const idC = await createNote(app, 'C');
    // A and C both link to B.
    repos.backlinks.replaceForSource(idA, [{ target_note_id: idB, link_text: 'B' }]);
    repos.backlinks.replaceForSource(idC, [{ target_note_id: idB, link_text: 'B' }]);

    const res = await app.request(`/notes/${idB}/backlinks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backlinks: { source_id: string; source_title: string; link_text: string }[];
    };
    const sources = body.backlinks.map((b) => b.source_id).sort();
    expect(sources).toEqual([idA, idC].sort());
    const titles = body.backlinks.map((b) => b.source_title).sort();
    expect(titles).toEqual(['A', 'C']);
  });

  test('returns empty array when no inbound links', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { now: fixedNow });
    const id = await createNote(app, 'lonely');
    const res = await app.request(`/notes/${id}/backlinks`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { backlinks: unknown[] }).backlinks).toEqual([]);
  });

  test('404 on unknown id', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/missing/backlinks');
    expect(res.status).toBe(404);
  });

  test('omits backlinks whose source note has been deleted', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const idA = await createNote(app, 'A');
    const idB = await createNote(app, 'B');
    repos.backlinks.replaceForSource(idA, [{ target_note_id: idB, link_text: 'B' }]);
    // Source A goes to trash — inbound list shouldn't surface a phantom source.
    repos.notes.softDelete(idA, FIXED_NOW.toISOString());

    const res = await app.request(`/notes/${idB}/backlinks`);
    const body = (await res.json()) as { backlinks: unknown[] };
    expect(body.backlinks).toEqual([]);
  });
});

describe('GET /notes/resolve (S-008)', () => {
  test('200 with id when exactly one note has that current title', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { now: fixedNow });
    const id = await createNote(app, 'Unique');

    const res = await app.request('/notes/resolve?title=Unique');
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toEqual({ id });
  });

  test('resolves a historical title (note was renamed away)', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { now: fixedNow });
    const id = await createNote(app, 'Original');
    // Rename — the old title becomes historical.
    await app.request(`/notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });

    // New title resolves to the same id.
    const r1 = await app.request('/notes/resolve?title=Renamed');
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { id: string }).id).toBe(id);

    // Old title still resolves to the same id.
    const r2 = await app.request('/notes/resolve?title=Original');
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { id: string }).id).toBe(id);
  });

  test('404 when no note has used that title', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/resolve?title=NeverUsed');
    expect(res.status).toBe(404);
  });

  test('300 with candidates when two notes share the same title', async ({ db }) => {
    const { app } = buildTestNotesApp(db, { now: fixedNow });
    const idA = await createNote(app, 'Twin');
    const idB = await createNote(app, 'Twin');

    const res = await app.request('/notes/resolve?title=Twin');
    expect(res.status).toBe(300);
    const body = (await res.json()) as { candidates: { id: string }[] };
    expect(body.candidates.map((c) => c.id).sort()).toEqual([idA, idB].sort());
  });

  test('400 when ?title is missing', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    const res = await app.request('/notes/resolve');
    expect(res.status).toBe(400);
  });
});

describe('GET /search (S-011)', () => {
  test('returns id/title/snippet for FTS matches', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const id = await createNote(app, 'Mushroom risotto');
    repos.notes.updateMarkdownExport(
      id,
      'A creamy mushroom risotto with porcini and parmesan.',
      FIXED_NOW.toISOString(),
    );

    const res = await app.request('/search?q=porcini');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: { id: string; title: string; snippet: string }[] };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]?.id).toBe(id);
    expect(body.hits[0]?.title).toBe('Mushroom risotto');
    expect(body.hits[0]?.snippet).toContain('porcini');
  });

  test('omits trashed notes from results', async ({ db }) => {
    const { app, repos } = buildTestNotesApp(db, { now: fixedNow });
    const id = await createNote(app, 'doomed');
    repos.notes.updateMarkdownExport(id, 'distinctiveword', FIXED_NOW.toISOString());
    repos.notes.softDelete(id, FIXED_NOW.toISOString());

    const res = await app.request('/search?q=distinctiveword');
    expect(((await res.json()) as { hits: unknown[] }).hits).toEqual([]);
  });

  test('400 when ?q is missing or empty', async ({ db }) => {
    const { app } = buildTestNotesApp(db);
    expect((await app.request('/search')).status).toBe(400);
    expect((await app.request('/search?q=')).status).toBe(400);
  });
});
