// I-003 import endpoint: multipart upload of one or more .md files,
// each becomes a note with the parsed PM doc seeded into Yjs storage
// and frontmatter tags applied.
//
// Tests use an in-memory Yjs accessor (no Hocuspocus) — the endpoint's
// only requirement is `replace(noteId, encoded)` so we can verify
// state was actually seeded by reading the same accessor back.

import { describe, expect } from 'vitest';
import { Hono } from 'hono';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { AuthVars, User } from '../auth/index.js';
import { errorHandler } from '../http/errors.js';
import { schema } from '../derived/schema.js';
import { createImportApp } from './routes.js';
import { createInMemoryAccessor } from '../snapshots/yjs-access.js';
import { createRepositories } from '../db/repositories/index.js';
import { test as dbTest } from '../db/test-fixture.js';

const TEST_USER: User = {
  id: 'u-test-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#ff0080',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

function buildImportTestApp(
  db: Parameters<typeof createRepositories>[0],
  options: { user?: User | null } = {},
): {
  app: Hono<{ Variables: AuthVars }>;
  docs: Map<string, Y.Doc>;
  repos: ReturnType<typeof createRepositories>;
} {
  const repos = createRepositories(db);
  const docs = new Map<string, Y.Doc>();
  const yjs = createInMemoryAccessor(docs);
  const user = options.user === undefined ? TEST_USER : options.user;

  const app = new Hono<{ Variables: AuthVars }>();
  app.onError(errorHandler());
  app.use('*', async (c, next) => {
    if (user === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'no session' } }, 401);
    }
    c.set('user', user);
    await next();
  });
  const imp = createImportApp({ repos, yjs });
  app.route('/', imp);
  return { app, docs, repos };
}

function buildMultipart(files: { filename: string; content: string; type?: string }[]): {
  body: Blob;
  headers: Record<string, string>;
} {
  // Use the WHATWG FormData + the runtime's automatic multipart
  // boundary; Hono's c.req.formData() parses these natively.
  const fd = new FormData();
  for (const f of files) {
    fd.append('files', new Blob([f.content], { type: f.type ?? 'text/markdown' }), f.filename);
  }
  // fetch() / Hono test request will pull the right Content-Type from
  // the FormData via the body; we return both so callers can wire
  // them up.
  return { body: fd as unknown as Blob, headers: {} };
}

function bodyOfPara(doc: Y.Doc): string {
  const frag = doc.getXmlFragment('prosemirror');
  if (frag.length === 0) return '';
  const pm = yXmlFragmentToProseMirrorRootNode(frag, schema);
  return pm.textContent;
}

describe('POST /notes/import (I-003)', () => {
  dbTest('accepts a single .md file and creates one note', async ({ db }) => {
    const { app, docs, repos } = buildImportTestApp(db);
    const { body } = buildMultipart([
      {
        filename: 'one.md',
        content: '---\ntitle: One\ntags: [travel]\n---\n\n# Hello\n\nbody text',
      },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { notes: { id: string; title: string }[] };
    expect(json.notes).toHaveLength(1);
    expect(json.notes[0]!.title).toBe('One');
    // Note row exists.
    const row = repos.notes.findById(json.notes[0]!.id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('One');
    // Tags applied.
    expect(repos.tags.listForNote(row!.id)).toEqual(['travel']);
    // Yjs state seeded.
    const ydoc = docs.get(row!.id);
    expect(ydoc).toBeDefined();
    expect(bodyOfPara(ydoc!)).toContain('body text');
  });

  dbTest('accepts 2 files in a single request and creates 2 notes with tags', async ({ db }) => {
    const { app, docs, repos } = buildImportTestApp(db);
    const { body } = buildMultipart([
      {
        filename: 'first.md',
        content: '---\ntitle: First\ntags: [a, b]\n---\n\nfirst body',
      },
      {
        filename: 'second.md',
        content: '---\ntitle: Second\ntags: [c]\n---\n\nsecond body',
      },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { notes: { id: string; title: string }[] };
    expect(json.notes).toHaveLength(2);
    const titles = json.notes.map((n) => n.title).sort();
    expect(titles).toEqual(['First', 'Second']);
    // Each note has its frontmatter tags applied.
    for (const n of json.notes) {
      const tags = repos.tags.listForNote(n.id).sort();
      if (n.title === 'First') expect(tags).toEqual(['a', 'b']);
      else if (n.title === 'Second') expect(tags).toEqual(['c']);
    }
    // Each note has Yjs state.
    expect(docs.size).toBe(2);
  });

  dbTest('falls back to filename-derived title when no frontmatter title', async ({ db }) => {
    const { app, repos } = buildImportTestApp(db);
    const { body } = buildMultipart([
      { filename: 'no-front-matter.md', content: '# something\n\nbody' },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(201);
    const { notes } = (await res.json()) as { notes: { id: string; title: string }[] };
    // Strip .md, keep original casing.
    expect(notes[0]!.title).toBe('no-front-matter');
    const row = repos.notes.findById(notes[0]!.id);
    expect(row!.title).toBe('no-front-matter');
  });

  dbTest('rejects a non-.md file with 400', async ({ db }) => {
    const { app } = buildImportTestApp(db);
    const { body } = buildMultipart([
      { filename: 'wrong.txt', content: 'not markdown', type: 'text/plain' },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(400);
  });

  dbTest('rejects an empty upload with 400', async ({ db }) => {
    const { app } = buildImportTestApp(db);
    const fd = new FormData();
    const res = await app.request('/notes/import', {
      method: 'POST',
      body: fd as unknown as Blob,
    });
    expect(res.status).toBe(400);
  });

  dbTest('401 when no session', async ({ db }) => {
    const { app } = buildImportTestApp(db, { user: null });
    const { body } = buildMultipart([{ filename: 'x.md', content: 'body' }]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(401);
  });

  dbTest('returns 400 on malformed YAML frontmatter', async ({ db }) => {
    const { app } = buildImportTestApp(db);
    const { body } = buildMultipart([
      { filename: 'bad.md', content: '---\ntitle: "unclosed\n---\n\nbody' },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body });
    expect(res.status).toBe(400);
  });
});
