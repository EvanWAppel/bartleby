// I-004 / I-005 / I-006 export route tests.

import { describe, expect } from 'vitest';
import { Hono } from 'hono';
import { unzipSync, strFromU8 } from 'fflate';
import { test as base } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { errorHandler } from '../http/errors.js';
import type { AuthVars, User } from '../auth/index.js';
import { createExportApp } from './routes.js';

const TEST_USER: User = {
  id: 'u-test-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#ff0080',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

interface ExportFixture {
  db: Database;
  app: Hono<{ Variables: AuthVars }>;
}

const test = base.extend<ExportFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  app: async ({ db }, use) => {
    const repos = createRepositories(db);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createExportApp({ repos }));
    await use(app);
  },
});

function seedUser(db: Database): void {
  const repos = createRepositories(db);
  repos.users.insert({
    id: TEST_USER.id,
    email: TEST_USER.email,
    display_name: TEST_USER.displayName,
    color: TEST_USER.color,
    created_at: '2026-05-23T00:00:00.000Z',
  });
}

function seedNote(
  db: Database,
  id: string,
  title: string,
  markdown: string,
  tags: string[] = [],
): void {
  const repos = createRepositories(db);
  repos.notes.insert({
    id,
    title,
    created_by: TEST_USER.id,
    created_at: '2026-06-22T11:00:00.000Z',
    updated_at: '2026-06-22T11:00:00.000Z',
    trashed_at: null,
    markdown_export: markdown,
  });
  if (tags.length > 0) {
    repos.tags.replaceForNote(id, tags);
  }
}

describe('GET /notes/:id/export.md (I-004)', () => {
  test('returns markdown with frontmatter (title + tags)', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, 'note-1', 'My Trip', '# Day 1\n\nbody', ['travel', 'photography']);
    const res = await app.request('/notes/note-1/export.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('my-trip.md');
    const text = await res.text();
    // The tags repo returns sorted alphabetically; matches the order
    // a future re-import sees, so a round-trip through Bartleby is
    // stable.
    expect(text).toBe('---\ntitle: "My Trip"\ntags: [photography, travel]\n---\n\n# Day 1\n\nbody');
  });

  test('omits tags line when the note has no tags', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, 'note-2', 'Plain', 'body');
    const res = await app.request('/notes/note-2/export.md');
    const text = await res.text();
    expect(text).toBe('---\ntitle: Plain\n---\n\nbody');
  });

  test('404 on unknown id', async ({ app }) => {
    const res = await app.request('/notes/no-such/export.md');
    expect(res.status).toBe(404);
  });

  test('404 on trashed note', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, 'gone', 'Goner', 'body');
    const repos = createRepositories(db);
    repos.notes.softDelete('gone', '2026-06-22T13:00:00.000Z');
    const res = await app.request('/notes/gone/export.md');
    expect(res.status).toBe(404);
  });
});

describe('GET /export/all.zip (I-005 + I-006)', () => {
  test('returns a zip containing one .md per live note', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, 'a', 'Trip to Spain', '# Spain\n\nbody A');
    seedNote(db, 'b', 'Q3 Plan', '# Plan\n\nbody B', ['ops']);

    const res = await app.request('/export/all.zip');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toContain('bartleby-notes.zip');

    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(['q3-plan.md', 'trip-to-spain.md']);
    expect(strFromU8(entries['trip-to-spain.md']!)).toContain('# Spain');
    expect(strFromU8(entries['q3-plan.md']!)).toContain('tags: [ops]');
  });

  test('excludes trashed notes', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, 'live', 'Live', 'body');
    seedNote(db, 'trashed', 'Trashed', 'body');
    const repos = createRepositories(db);
    repos.notes.softDelete('trashed', '2026-06-22T13:00:00.000Z');

    const res = await app.request('/export/all.zip');
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    expect(Object.keys(entries)).toEqual(['live.md']);
  });

  test('appends an id suffix when slugified titles collide (I-006)', async ({ db, app }) => {
    seedUser(db);
    seedNote(db, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Trip', 'a');
    seedNote(db, '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TRIP', 'b');
    seedNote(db, '33333333-cccc-cccc-cccc-cccccccccccc', 'trip', 'c');

    const res = await app.request('/export/all.zip');
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(['trip-22222222.md', 'trip-33333333.md', 'trip.md']);
  });

  test('returns a valid empty zip when there are no notes', async ({ app }) => {
    const res = await app.request('/export/all.zip');
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    // unzipSync would throw if the bytes weren't a valid zip; an
    // empty archive yields an empty Record.
    const entries = unzipSync(buf);
    expect(Object.keys(entries)).toEqual([]);
  });
});
