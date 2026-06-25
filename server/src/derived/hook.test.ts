// Integration: feed the derived-state hook a YDoc and assert it
// updates notes.markdown_export + tags + backlinks atomically. The
// FTS5 trigger fires off the markdown_export UPDATE automatically.

import { describe, expect } from 'vitest';
import * as Y from 'yjs';
import {
  prosemirrorToYXmlFragment,
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
} from 'y-prosemirror';
import pino from 'pino';
import { test } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { createDerivedStateHook } from './hook.js';
import { schema } from './schema.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const logger = pino({ level: 'silent' });

function seedNote(db: import('better-sqlite3').Database, id: string, title = 'Test'): void {
  const repos = createRepositories(db);
  if (repos.users.findById('u1') === undefined) {
    repos.users.insert({
      id: 'u1',
      email: 'a@a.a',
      display_name: 'a',
      color: '#000',
      created_at: NOW.toISOString(),
    });
  }
  repos.notes.insert({
    id,
    title,
    created_by: 'u1',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    trashed_at: null,
    markdown_export: '',
  });
  repos.noteTitlesHistory.append(id, title, NOW.toISOString());
}

function buildYDocWithParagraph(text: string): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('prosemirror');
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]),
    fragment,
  );
  return doc;
}

describe('createDerivedStateHook (S-009)', () => {
  test('updates markdown_export', async ({ db }) => {
    seedNote(db, 'note-1');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('hello there');
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-1' });

    expect(repos.notes.findById('note-1')?.markdown_export).toBe('hello there');
  });

  test('writes inline #hashtags into tags table', async ({ db }) => {
    seedNote(db, 'note-2');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('a note about #travel and #cooking');
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-2' });

    expect(repos.tags.listForNote('note-2').sort()).toEqual(['cooking', 'travel']);
  });

  test('replaces tags atomically (old tags gone, new tags present)', async ({ db }) => {
    seedNote(db, 'note-3');
    const repos = createRepositories(db);
    repos.tags.replaceForNote('note-3', ['stale']);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('only one #fresh tag');
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-3' });

    expect(repos.tags.listForNote('note-3')).toEqual(['fresh']);
  });

  test('writes resolved [[backlinks]] into backlinks table', async ({ db }) => {
    seedNote(db, 'src');
    seedNote(db, 'dst', 'Spain');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('See [[Spain]] for trip notes');
    await hook.onStoreDocument({ document: ydoc, documentName: 'src' });

    const inbound = repos.backlinks.listInbound('dst');
    expect(inbound.map((b) => b.source_note_id)).toEqual(['src']);
    expect(inbound[0]?.link_text).toBe('Spain');
  });

  test('drops [[links]] to unknown titles silently', async ({ db }) => {
    seedNote(db, 'src');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('See [[NoSuchNote]]');
    await hook.onStoreDocument({ document: ydoc, documentName: 'src' });

    expect(repos.backlinks.listOutbound('src')).toEqual([]);
  });

  test('FTS finds the note after the hook runs', async ({ db }) => {
    seedNote(db, 'searchable');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('a paragraph mentioning porcini specifically');
    await hook.onStoreDocument({ document: ydoc, documentName: 'searchable' });

    const hits = repos.search.searchNotes('porcini');
    expect(hits.map((h) => h.id)).toEqual(['searchable']);
  });

  test('is a no-op when no notes row exists for the doc name', async ({ db }) => {
    // The doc could exist in Hocuspocus's `documents` table before its
    // metadata row gets created — skip cleanly without throwing.
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    const ydoc = buildYDocWithParagraph('orphan content');
    await expect(
      hook.onStoreDocument({ document: ydoc, documentName: 'no-such-note' }),
    ).resolves.toBeUndefined();
  });

  test('C-008: marks a comment is_orphaned when its anchored text is deleted', async ({ db }) => {
    seedNote(db, 'note-orphan');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });

    // Seed a doc with "hello world" and capture an anchor for "world".
    const ydoc = buildYDocWithParagraph('hello world');
    const fragment = ydoc.getXmlFragment('prosemirror');
    const { mapping } = initProseMirrorDoc(fragment, schema);
    const fromRel = absolutePositionToRelativePosition(7, fragment, mapping as never);
    const toRel = absolutePositionToRelativePosition(12, fragment, mapping as never);
    const anchor = JSON.stringify({
      from: Y.relativePositionToJSON(fromRel),
      to: Y.relativePositionToJSON(toRel),
    });

    const comment = repos.comments.insert({
      id: 'c-orphan',
      note_id: 'note-orphan',
      author_id: 'u1',
      parent_comment_id: null,
      anchor,
      original_quote: 'world',
      body: 'a comment',
      created_at: NOW.toISOString(),
    });
    expect(comment.is_orphaned).toBe(false);

    // First pass: doc is unchanged → comment stays anchored.
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-orphan' });
    expect(repos.comments.findById('c-orphan')?.is_orphaned).toBe(false);

    // Now wipe the paragraph and rebuild with different text — the
    // anchored items get tombstoned and the anchor can't resolve.
    ydoc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(
        schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('completely different content')]),
        ]),
        fragment,
      );
    });
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-orphan' });
    expect(repos.comments.findById('c-orphan')?.is_orphaned).toBe(true);
  });

  test('C-008: orphans an unparseable anchor', async ({ db }) => {
    seedNote(db, 'note-bad-anchor');
    const repos = createRepositories(db);
    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });
    repos.comments.insert({
      id: 'c-bad',
      note_id: 'note-bad-anchor',
      author_id: 'u1',
      parent_comment_id: null,
      anchor: '', // empty / unparseable
      original_quote: '',
      body: 'no anchor',
      created_at: NOW.toISOString(),
    });

    const ydoc = buildYDocWithParagraph('whatever');
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-bad-anchor' });
    expect(repos.comments.findById('c-bad')?.is_orphaned).toBe(true);
  });

  test('M-005: onMentionInserted fires once per net-new mention row', async ({ db }) => {
    seedNote(db, 'note-mention');
    const repos = createRepositories(db);
    // Seed a recipient so the mention extractor resolves the email.
    repos.users.insert({
      id: 'u-bob',
      email: 'bob@example.com',
      display_name: 'Bob',
      color: '#bbb',
      created_at: NOW.toISOString(),
    });
    const fired: string[] = [];
    const hook = createDerivedStateHook({
      repos,
      logger,
      now: () => NOW,
      onMentionInserted: (id) => fired.push(id),
    });

    const ydoc = buildYDocWithParagraph('hey @bob@example.com check this out');
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-mention' });
    expect(fired).toHaveLength(1);

    // Re-running with the same markdown is idempotent — no new row,
    // no new callback.
    await hook.onStoreDocument({ document: ydoc, documentName: 'note-mention' });
    expect(fired).toHaveLength(1);
  });

  test('skips trashed notes (do not derive state for soft-deleted docs)', async ({ db }) => {
    seedNote(db, 'doomed');
    const repos = createRepositories(db);
    repos.notes.softDelete('doomed', NOW.toISOString());
    const before = repos.notes.findById('doomed');
    expect(before?.markdown_export).toBe('');

    const hook = createDerivedStateHook({ repos, logger, now: () => NOW });
    const ydoc = buildYDocWithParagraph('should not be derived');
    await hook.onStoreDocument({ document: ydoc, documentName: 'doomed' });

    expect(repos.notes.findById('doomed')?.markdown_export).toBe('');
  });
});
