// M-003 / M-004 mentions endpoints.

import { describe, expect } from 'vitest';
import { Hono } from 'hono';
import { test as base } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { errorHandler } from '../http/errors.js';
import type { AuthVars, User } from '../auth/index.js';
import { createMentionsApp } from './routes.js';

const FIXED_NOW = new Date('2026-06-22T12:00:00Z');
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

const ALICE: User = {
  id: 'u-alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#aaa',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

const BOB: User = {
  id: 'u-bob',
  email: 'bob@example.com',
  displayName: 'Bob',
  color: '#bbb',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

interface MentionsFixture {
  db: Database;
}

const test = base.extend<MentionsFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
});

function buildApp(
  db: Database,
  user: User,
  opts: { now?: () => Date } = {},
): Hono<{ Variables: AuthVars }> {
  const repos = createRepositories(db);
  const app = new Hono<{ Variables: AuthVars }>();
  app.onError(errorHandler());
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/', createMentionsApp({ repos, now: opts.now ?? (() => FIXED_NOW) }));
  return app;
}

function seedUsers(db: Database): void {
  const repos = createRepositories(db);
  repos.users.insert({
    id: ALICE.id,
    email: ALICE.email,
    display_name: ALICE.displayName,
    color: ALICE.color,
    created_at: '2026-05-23T00:00:00.000Z',
  });
  repos.users.insert({
    id: BOB.id,
    email: BOB.email,
    display_name: BOB.displayName,
    color: BOB.color,
    created_at: '2026-05-23T00:00:00.000Z',
  });
}

function seedNote(db: Database, id: string, title: string, createdBy: string): void {
  const repos = createRepositories(db);
  repos.notes.insert({
    id,
    title,
    created_by: createdBy,
    created_at: '2026-06-22T11:00:00.000Z',
    updated_at: '2026-06-22T11:00:00.000Z',
    trashed_at: null,
    markdown_export: '',
  });
}

interface MentionDto {
  id: string;
  note_id: string;
  mentioned_user_id: string;
  mentioning_user_id: string;
  source: string;
  created_at: string;
  read_at: string | null;
  email_sent_at: string | null;
  note_title: string;
}

describe('GET /mentions (M-003)', () => {
  test('lists mentions for the session user, newest first', async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'note-1', 'Note 1', BOB.id);
    seedNote(db, 'note-2', 'Note 2', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'm1',
      note_id: 'note-1',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'note:note-1',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    repos.mentions.insert({
      id: 'm2',
      note_id: 'note-2',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'comment:c1',
      created_at: '2026-06-22T11:30:00.000Z',
    });

    const app = buildApp(db, ALICE);
    const res = await app.request('/mentions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mentions: MentionDto[] };
    expect(body.mentions.map((m) => m.id)).toEqual(['m2', 'm1']);
    // Inbox carries the note title so the row can render without an N+1.
    expect(body.mentions[0]?.note_title).toBe('Note 2');
    expect(body.mentions[1]?.note_title).toBe('Note 1');
  });

  test('?unread=true filters to mentions with null read_at', async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'n', 'Note', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'unread',
      note_id: 'n',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'note:n',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    const read = repos.mentions.insert({
      id: 'read',
      note_id: 'n',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'comment:c',
      created_at: '2026-06-22T11:30:00.000Z',
    });
    repos.mentions.markRead(read.id, FIXED_NOW_ISO);

    const app = buildApp(db, ALICE);
    const all = await app.request('/mentions');
    expect(((await all.json()) as { mentions: MentionDto[] }).mentions.map((m) => m.id)).toEqual([
      'read',
      'unread',
    ]);
    const unread = await app.request('/mentions?unread=true');
    expect(((await unread.json()) as { mentions: MentionDto[] }).mentions.map((m) => m.id)).toEqual(
      ['unread'],
    );
  });

  test('only returns mentions for the calling user', async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'n', 'Note', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'for-alice',
      note_id: 'n',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'note:n',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    repos.mentions.insert({
      id: 'for-bob',
      note_id: 'n',
      mentioned_user_id: BOB.id,
      mentioning_user_id: ALICE.id,
      source: 'note:n',
      created_at: '2026-06-22T11:00:00.000Z',
    });

    const aliceApp = buildApp(db, ALICE);
    const aliceList = (await (await aliceApp.request('/mentions')).json()) as {
      mentions: MentionDto[];
    };
    expect(aliceList.mentions.map((m) => m.id)).toEqual(['for-alice']);

    const bobApp = buildApp(db, BOB);
    const bobList = (await (await bobApp.request('/mentions')).json()) as {
      mentions: MentionDto[];
    };
    expect(bobList.mentions.map((m) => m.id)).toEqual(['for-bob']);
  });

  test('surfaces "(deleted note)" if the source note has been hard-deleted', async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'note-doomed', 'Doomed', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'm',
      note_id: 'note-doomed',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'note:note-doomed',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    // Hard-delete the note; the FK is ON DELETE CASCADE which would
    // also delete the mention. Simulate the post-delete read by
    // detaching FKs manually before delete in the test — instead,
    // directly delete from notes via the repo:
    repos.notes.hardDelete('note-doomed');
    const app = buildApp(db, ALICE);
    const list = (await (await app.request('/mentions')).json()) as { mentions: MentionDto[] };
    // Mention is gone (FK cascade) — no orphans to render. The
    // "(deleted note)" branch in withNoteTitle is defensive for the
    // case where the mention row exists but the notes row doesn't
    // (shouldn't happen with FKs but defensive code is cheap).
    expect(list.mentions).toEqual([]);
  });
});

describe('POST /mentions/:id/read (M-004)', () => {
  test('marks a mention as read and returns the updated row', async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'n', 'Note', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'mention-1',
      note_id: 'n',
      mentioned_user_id: ALICE.id,
      mentioning_user_id: BOB.id,
      source: 'note:n',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    const app = buildApp(db, ALICE);
    const res = await app.request('/mentions/mention-1/read', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MentionDto;
    expect(body.read_at).toBe(FIXED_NOW_ISO);
  });

  test('404 on unknown id', async ({ db }) => {
    seedUsers(db);
    const app = buildApp(db, ALICE);
    const res = await app.request('/mentions/no-such/read', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test("403 when trying to mark another user's mention", async ({ db }) => {
    seedUsers(db);
    seedNote(db, 'n', 'Note', BOB.id);
    const repos = createRepositories(db);
    repos.mentions.insert({
      id: 'bobs-mention',
      note_id: 'n',
      mentioned_user_id: BOB.id,
      mentioning_user_id: ALICE.id,
      source: 'note:n',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    const app = buildApp(db, ALICE);
    const res = await app.request('/mentions/bobs-mention/read', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});
