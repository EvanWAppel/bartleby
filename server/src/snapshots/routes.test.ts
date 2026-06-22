// C-003 / C-004 / C-006 snapshot routes.

import { describe, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { errorHandler } from '../http/errors.js';
import type { AuthVars, User } from '../auth/index.js';
import { createNotesApp } from '../notes/routes.js';
import { createSnapshotsApp } from './routes.js';
import { createInMemoryAccessor } from './yjs-access.js';
import { schema } from '../derived/schema.js';
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

interface SnapshotsFixture {
  db: Database;
  app: Hono<{ Variables: AuthVars }>;
  docs: Map<string, Y.Doc>;
  noteId: string;
}

function makeYDocWithText(text: string): Y.Doc {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]),
    doc.getXmlFragment('prosemirror'),
  );
  return doc;
}

function extractText(doc: Y.Doc): string {
  const frag = doc.getXmlFragment('prosemirror');
  if (frag.length === 0) return '';
  const root = yXmlFragmentToProseMirrorRootNode(frag, schema);
  return root.textContent;
}

interface BuildOpts {
  now?: () => Date;
  autoSnapshotRetention?: number;
}

function buildSnapshotsApp(
  db: Database,
  opts: BuildOpts = {},
): { app: Hono<{ Variables: AuthVars }>; docs: Map<string, Y.Doc> } {
  const repos = createRepositories(db);
  const docs = new Map<string, Y.Doc>();
  const yjs = createInMemoryAccessor(docs);
  const app = new Hono<{ Variables: AuthVars }>();
  app.onError(errorHandler());
  app.use('*', async (c, next) => {
    c.set('user', TEST_USER);
    await next();
  });
  app.route('/', createNotesApp({ repos, now: opts.now ?? (() => FIXED_NOW) }));
  app.route(
    '/',
    createSnapshotsApp({
      repos,
      yjs,
      now: opts.now ?? (() => FIXED_NOW),
      autoSnapshotRetention: opts.autoSnapshotRetention,
    }),
  );
  return { app, docs };
}

const test = base.extend<SnapshotsFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  app: async ({ db }, use) => {
    const { app } = buildSnapshotsApp(db);
    await use(app);
  },
  docs: async ({ db }, use) => {
    const { docs } = buildSnapshotsApp(db);
    await use(docs);
  },
  noteId: async ({ db }, use) => {
    const { app } = buildSnapshotsApp(db);
    const res = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host note' }),
    });
    const body = (await res.json()) as { id: string };
    await use(body.id);
  },
});

interface SnapshotDto {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
  yjs_state_base64?: string;
}

describe('POST /notes/:id/snapshots (C-003)', () => {
  test('creates a named snapshot of the current Yjs state', async ({ db }) => {
    const { app, docs } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    docs.set(noteId, makeYDocWithText('hello snapshot'));

    const res = await app.request(`/notes/${noteId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'v1.0' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SnapshotDto;
    expect(body.note_id).toBe(noteId);
    expect(body.label).toBe('v1.0');
    expect(body.created_at).toBe(FIXED_NOW_ISO);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('404 when note does not exist', async ({ app }) => {
    const res = await app.request('/notes/no-such-id/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'v1' }),
    });
    expect(res.status).toBe(404);
  });

  test('400 when label is missing or empty', async ({ db }) => {
    const { app } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;

    let res = await app.request(`/notes/${noteId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    res = await app.request(`/notes/${noteId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /notes/:id/snapshots (C-004)', () => {
  test('lists snapshots newest first; supports limit/offset', async ({ db }) => {
    const { app, docs } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    docs.set(noteId, makeYDocWithText('snap'));

    // Create three named snapshots with monotonically-increasing
    // timestamps so list order is unambiguous.
    const T = [
      new Date('2026-06-21T12:00:00Z'),
      new Date('2026-06-21T12:01:00Z'),
      new Date('2026-06-21T12:02:00Z'),
    ];
    for (let i = 0; i < T.length; i += 1) {
      const moment = T[i];
      const built = buildSnapshotsApp(db, { now: () => moment });
      await built.app.request(`/notes/${noteId}/snapshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: `v${i + 1}` }),
      });
    }

    const res = await app.request(`/notes/${noteId}/snapshots`);
    const body = (await res.json()) as { snapshots: SnapshotDto[] };
    expect(body.snapshots.map((s) => s.label)).toEqual(['v3', 'v2', 'v1']);

    const paged = await app.request(`/notes/${noteId}/snapshots?limit=1&offset=1`);
    const pagedBody = (await paged.json()) as { snapshots: SnapshotDto[] };
    expect(pagedBody.snapshots.map((s) => s.label)).toEqual(['v2']);
  });

  test('400 on bad pagination', async ({ db }) => {
    const { app } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;

    const r = await app.request(`/notes/${noteId}/snapshots?limit=-1`);
    expect(r.status).toBe(400);
  });

  test('404 when note does not exist', async ({ app }) => {
    const res = await app.request('/notes/no-such/snapshots');
    expect(res.status).toBe(404);
  });
});

describe('GET /notes/:id/snapshots/:snap_id (preview)', () => {
  test('returns yjs_state_base64 so the preview pane can decode + render', async ({ db }) => {
    const { app, docs } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    docs.set(noteId, makeYDocWithText('previewable content'));

    const createRes = await app.request(`/notes/${noteId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'preview-me' }),
    });
    const snap = (await createRes.json()) as SnapshotDto;

    const getRes = await app.request(`/notes/${noteId}/snapshots/${snap.id}`);
    const got = (await getRes.json()) as SnapshotDto;
    expect(got.label).toBe('preview-me');
    expect(got.yjs_state_base64).toBeDefined();
    expect(typeof got.yjs_state_base64).toBe('string');
    expect((got.yjs_state_base64 ?? '').length).toBeGreaterThan(0);

    // Decode + verify it round-trips back to the original text.
    const bytes = Buffer.from(got.yjs_state_base64 ?? '', 'base64');
    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(bytes));
    expect(extractText(restored)).toBe('previewable content');
  });

  test('404 when snapshot does not belong to that note', async ({ db }) => {
    const { app, docs } = buildSnapshotsApp(db);
    // Two notes; snapshot belongs to A, fetch via B's URL → 404.
    const aRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A' }),
    });
    const a = ((await aRes.json()) as { id: string }).id;
    const bRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'B' }),
    });
    const b = ((await bRes.json()) as { id: string }).id;
    docs.set(a, makeYDocWithText('in A'));

    const createRes = await app.request(`/notes/${a}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'belongs-to-A' }),
    });
    const snap = (await createRes.json()) as SnapshotDto;
    const wrong = await app.request(`/notes/${b}/snapshots/${snap.id}`);
    expect(wrong.status).toBe(404);
  });
});

describe('POST /notes/:id/snapshots/:snap_id/restore (C-006)', () => {
  test('restoring replaces document content + writes a pre-restore auto-snapshot', async ({
    db,
  }) => {
    const { app, docs } = buildSnapshotsApp(db);
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;

    // Initial content "v1" → snapshot it.
    docs.set(noteId, makeYDocWithText('v1'));
    const v1Res = await app.request(`/notes/${noteId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'v1' }),
    });
    const v1 = (await v1Res.json()) as SnapshotDto;

    // Live doc moves to "v2".
    docs.set(noteId, makeYDocWithText('v2'));

    // Restore to v1.
    const restoreRes = await app.request(`/notes/${noteId}/snapshots/${v1.id}/restore`, {
      method: 'POST',
    });
    expect(restoreRes.status).toBe(200);

    // The live doc now reads "v1" (this is the C-006 spec assertion).
    const live = docs.get(noteId);
    expect(live).toBeDefined();
    expect(extractText(live!)).toBe('v1');

    // A pre-restore auto-snapshot of "v2" was recorded — the most-
    // recent snapshot in the list before the named v1.
    const listRes = await app.request(`/notes/${noteId}/snapshots`);
    const list = ((await listRes.json()) as { snapshots: SnapshotDto[] }).snapshots;
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Newest first; the pre-restore is unlabeled.
    const preRestore = list[0];
    expect(preRestore?.label).toBeNull();
    // Verify its bytes equal v2.
    const detail = await app.request(`/notes/${noteId}/snapshots/${preRestore?.id}`);
    const detailBody = (await detail.json()) as SnapshotDto;
    const bytes = Buffer.from(detailBody.yjs_state_base64 ?? '', 'base64');
    const reHydrated = new Y.Doc();
    Y.applyUpdate(reHydrated, new Uint8Array(bytes));
    expect(extractText(reHydrated)).toBe('v2');
  });

  test('404 when snapshot belongs to a different note', async ({ db }) => {
    const { app, docs } = buildSnapshotsApp(db);
    const aRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A' }),
    });
    const a = ((await aRes.json()) as { id: string }).id;
    const bRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'B' }),
    });
    const b = ((await bRes.json()) as { id: string }).id;
    docs.set(a, makeYDocWithText('A'));
    const createRes = await app.request(`/notes/${a}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'A-only' }),
    });
    const snap = (await createRes.json()) as SnapshotDto;
    const res = await app.request(`/notes/${b}/snapshots/${snap.id}/restore`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});

describe('C-005 retention via the routes', () => {
  beforeEach(() => {
    // no-op; the buildSnapshotsApp helper allows per-test retention config.
  });

  test('restore writes a pre-restore auto-snapshot; older auto-snapshots beyond cap are pruned', async ({
    db,
  }) => {
    // Retention=2 so the test doesn't have to fabricate 50 snapshots.
    // Sequence:
    //   - create 3 auto-snapshots manually (via repo) — only 2 will
    //     remain after the next prune.
    //   - restore from one of them. The restore writes another pre-
    //     restore auto-snapshot, then prunes to retention=2.
    const { app, docs } = buildSnapshotsApp(db, { autoSnapshotRetention: 2 });
    const noteRes = await app.request('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'host' }),
    });
    const noteId = ((await noteRes.json()) as { id: string }).id;
    docs.set(noteId, makeYDocWithText('live'));

    // One named (always kept; bytes must be a valid Yjs update because
    // the restore handler decodes them) + three auto (capped at 2
    // after prune; their bytes are irrelevant since they're never
    // applied).
    const repos = createRepositories(db);
    const namedBytes = Y.encodeStateAsUpdate(makeYDocWithText('kept'));
    const named = repos.snapshots.insert({
      id: '00000000-0000-0000-0000-000000000001',
      note_id: noteId,
      yjs_state: Buffer.from(namedBytes),
      created_at: '2026-06-21T11:00:00.000Z',
      label: 'kept-named',
    });
    repos.snapshots.insert({
      id: '00000000-0000-0000-0000-0000000000a1',
      note_id: noteId,
      yjs_state: Buffer.from(new Uint8Array([1])),
      created_at: '2026-06-21T11:01:00.000Z',
      label: null,
    });
    repos.snapshots.insert({
      id: '00000000-0000-0000-0000-0000000000a2',
      note_id: noteId,
      yjs_state: Buffer.from(new Uint8Array([2])),
      created_at: '2026-06-21T11:02:00.000Z',
      label: null,
    });
    repos.snapshots.insert({
      id: '00000000-0000-0000-0000-0000000000a3',
      note_id: noteId,
      yjs_state: Buffer.from(new Uint8Array([3])),
      created_at: '2026-06-21T11:03:00.000Z',
      label: null,
    });

    // Restore from the named snapshot. The restore handler writes a
    // pre-restore auto-snapshot, then prunes. Expected end-state:
    //   - 1 named (kept-named): always exempt.
    //   - 2 auto: the pre-restore + the most-recent (a3).
    const res = await app.request(`/notes/${noteId}/snapshots/${named.id}/restore`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const list = repos.snapshots.listByNote(noteId);
    const named_ = list.filter((r) => r.label !== null);
    const auto = list.filter((r) => r.label === null);
    expect(named_.map((n) => n.label)).toEqual(['kept-named']);
    expect(auto).toHaveLength(2);
  });
});
