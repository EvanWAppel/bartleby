// I-003 POST /notes/import.

import { describe, expect } from 'vitest';
import { Hono } from 'hono';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { errorHandler } from '../http/errors.js';
import type { AuthVars, User } from '../auth/index.js';
import { schema } from '../derived/schema.js';
import { createInMemoryAccessor } from '../snapshots/yjs-access.js';
import { createImportApp } from './routes.js';
import { test as base } from 'vitest';
import type { Database } from 'better-sqlite3';

const TEST_USER: User = {
  id: 'u-test-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  color: '#ff0080',
  createdAt: new Date('2026-05-23T00:00:00Z'),
};

interface ImportFixture {
  db: Database;
  app: Hono<{ Variables: AuthVars }>;
}

const test = base.extend<ImportFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  app: async ({ db }, use) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));
    await use(app);
  },
});

function buildMultipart(files: { name: string; content: string }[]): FormData {
  const form = new FormData();
  for (const f of files) {
    form.append('files', new File([f.content], f.name, { type: 'text/markdown' }));
  }
  return form;
}

function extractText(yjsState: Uint8Array): string {
  const d = new Y.Doc();
  Y.applyUpdate(d, yjsState);
  const frag = d.getXmlFragment('prosemirror');
  if (frag.length === 0) return '';
  return yXmlFragmentToProseMirrorRootNode(frag, schema).textContent;
}

describe('POST /notes/import (I-003)', () => {
  test('imports two .md files as two new notes (W-025 spec test)', async ({ db }) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));

    const form = buildMultipart([
      { name: 'first.md', content: '# First Note\n\nHello.' },
      { name: 'second.md', content: '# Second Note\n\nBody.' },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { notes: { id: string; title: string }[] };
    expect(body.notes).toHaveLength(2);

    // Two new rows in the notes table.
    const live = repos.notes.listLive();
    expect(live.filter((n) => n.title === 'first').length).toBe(1);
    expect(live.filter((n) => n.title === 'second').length).toBe(1);
  });

  test('frontmatter title overrides the filename', async ({ db }) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));

    const form = buildMultipart([
      {
        name: 'awkward-filename.md',
        content: '---\ntitle: Friendly Title\n---\nbody',
      },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body: form });
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes[0]?.title).toBe('Friendly Title');
  });

  test('falls back to "Untitled" when neither frontmatter title nor a usable filename exists', async ({
    db,
  }) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));

    const form = new FormData();
    form.append('files', new File(['body only'], '.md', { type: 'text/markdown' }));
    const res = await app.request('/notes/import', { method: 'POST', body: form });
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes[0]?.title).toBe('Untitled');
  });

  test('applies frontmatter tags to the imported note', async ({ db }) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));

    const form = buildMultipart([
      {
        name: 'tagged.md',
        content: '---\ntitle: Tagged\ntags: [travel, cooking]\n---\nbody',
      },
    ]);
    const res = await app.request('/notes/import', { method: 'POST', body: form });
    const body = (await res.json()) as { notes: { id: string }[] };
    const id = body.notes[0]!.id;
    expect(repos.tags.listForNote(id).sort()).toEqual(['cooking', 'travel']);
  });

  test('initial Yjs state contains the parsed body', async ({ db }) => {
    const repos = createRepositories(db);
    const docs = new Map<string, Y.Doc>();
    const yjs = createInMemoryAccessor(docs);
    const app = new Hono<{ Variables: AuthVars }>();
    app.onError(errorHandler());
    app.use('*', async (c, next) => {
      c.set('user', TEST_USER);
      await next();
    });
    app.route('/', createImportApp({ repos, yjs }));

    const form = buildMultipart([{ name: 'body.md', content: '# Heading\n\nimported body text.' }]);
    const res = await app.request('/notes/import', { method: 'POST', body: form });
    const body = (await res.json()) as { notes: { id: string }[] };
    const id = body.notes[0]!.id;
    const ydoc = docs.get(id);
    expect(ydoc).toBeDefined();
    const text = ydoc !== undefined ? extractText(Y.encodeStateAsUpdate(ydoc)) : '';
    expect(text).toContain('Heading');
    expect(text).toContain('imported body text');
  });

  test('400 when no files are uploaded', async ({ app }) => {
    const res = await app.request('/notes/import', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
});
