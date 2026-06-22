// C-002: auto-snapshot scheduler.

import { describe, expect } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import pino from 'pino';
import { test } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { tickAutoSnapshots } from './scheduler.js';
import { createInMemoryAccessor } from './yjs-access.js';
import { schema } from '../derived/schema.js';

const logger = pino({ level: 'silent' });

function seedNote(
  db: import('better-sqlite3').Database,
  id: string,
  updatedAt: string,
  title = 'Test',
): void {
  const repos = createRepositories(db);
  if (repos.users.findById('u1') === undefined) {
    repos.users.insert({
      id: 'u1',
      email: 'a@a.a',
      display_name: 'a',
      color: '#000',
      created_at: '2026-05-23T00:00:00.000Z',
    });
  }
  repos.notes.insert({
    id,
    title,
    created_by: 'u1',
    created_at: '2026-06-21T11:00:00.000Z',
    updated_at: updatedAt,
    trashed_at: null,
    markdown_export: '',
  });
}

function makeYDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]),
    doc.getXmlFragment('prosemirror'),
  );
  return doc;
}

describe('tickAutoSnapshots (C-002)', () => {
  test('snapshots a note that has been edited since the last snapshot', async ({ db }) => {
    seedNote(db, 'note-1', '2026-06-21T12:00:00.000Z');
    const repos = createRepositories(db);
    const docs = new Map([['note-1', makeYDoc('first edit')]]);
    const yjs = createInMemoryAccessor(docs);

    const result = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T12:00:30.000Z'),
      logger,
    });
    expect(result).toEqual({ created: 1, skipped: 0 });
    const list = repos.snapshots.listByNote('note-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBeNull();
  });

  test('skips a note that has NOT been edited since the last snapshot', async ({ db }) => {
    // Note's updated_at is BEFORE the seeded snapshot's created_at,
    // so the tick has nothing to do.
    seedNote(db, 'note-2', '2026-06-21T12:00:00.000Z');
    const repos = createRepositories(db);
    repos.snapshots.insert({
      id: '00000000-0000-0000-0000-0000000000a1',
      note_id: 'note-2',
      yjs_state: Buffer.from(new Uint8Array([1])),
      created_at: '2026-06-21T12:30:00.000Z',
      label: null,
    });
    const docs = new Map([['note-2', makeYDoc('quiescent')]]);
    const yjs = createInMemoryAccessor(docs);

    const result = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T13:00:00.000Z'),
      logger,
    });
    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(repos.snapshots.listByNote('note-2')).toHaveLength(1);
  });

  test('time-travelled spec scenario: tick after edit writes one row; second tick with no edit writes none', async ({
    db,
  }) => {
    seedNote(db, 'note-3', '2026-06-21T12:00:00.000Z');
    const repos = createRepositories(db);
    const docs = new Map([['note-3', makeYDoc('only edit')]]);
    const yjs = createInMemoryAccessor(docs);

    const first = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T12:05:00.000Z'),
      logger,
    });
    expect(first.created).toBe(1);

    // No further edits → updated_at hasn't moved. Second tick is a no-op.
    const second = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T12:10:00.000Z'),
      logger,
    });
    expect(second).toEqual({ created: 0, skipped: 1 });
    expect(repos.snapshots.listByNote('note-3')).toHaveLength(1);
  });

  test('snapshots all eligible notes in a single tick', async ({ db }) => {
    seedNote(db, 'multi-a', '2026-06-21T12:00:00.000Z');
    seedNote(db, 'multi-b', '2026-06-21T12:00:00.000Z');
    seedNote(db, 'multi-c', '2026-06-21T12:00:00.000Z');
    const repos = createRepositories(db);
    const docs = new Map([
      ['multi-a', makeYDoc('a')],
      ['multi-b', makeYDoc('b')],
      ['multi-c', makeYDoc('c')],
    ]);
    const yjs = createInMemoryAccessor(docs);

    const result = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T12:05:00.000Z'),
      logger,
    });
    expect(result).toEqual({ created: 3, skipped: 0 });
  });

  test('skips trashed notes', async ({ db }) => {
    seedNote(db, 'trashed', '2026-06-21T12:00:00.000Z');
    const repos = createRepositories(db);
    repos.notes.softDelete('trashed', '2026-06-21T11:30:00.000Z');
    const docs = new Map([['trashed', makeYDoc('whatever')]]);
    const yjs = createInMemoryAccessor(docs);

    const result = await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T12:05:00.000Z'),
      logger,
    });
    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(repos.snapshots.listByNote('trashed')).toHaveLength(0);
  });

  test('C-005 retention: keeps named snapshots and the most-recent N auto', async ({ db }) => {
    seedNote(db, 'cap', '2026-06-21T12:30:00.000Z');
    const repos = createRepositories(db);
    // Pre-seed: 1 named + 5 auto snapshots, all older than the note's
    // updated_at so the next tick adds a 6th auto. With retention=3
    // the final list should be 1 named + 3 auto (most-recent + tick's
    // new one).
    repos.snapshots.insert({
      id: 'n0',
      note_id: 'cap',
      yjs_state: Buffer.from(new Uint8Array([0])),
      created_at: '2026-06-21T10:00:00.000Z',
      label: 'kept-named',
    });
    for (let i = 1; i <= 5; i += 1) {
      const created = `2026-06-21T11:0${i}:00.000Z`;
      repos.snapshots.insert({
        id: `auto-${i}`,
        note_id: 'cap',
        yjs_state: Buffer.from(new Uint8Array([i])),
        created_at: created,
        label: null,
      });
    }
    const docs = new Map([['cap', makeYDoc('current')]]);
    const yjs = createInMemoryAccessor(docs);

    await tickAutoSnapshots({
      repos,
      yjs,
      now: () => new Date('2026-06-21T13:00:00.000Z'),
      logger,
      autoSnapshotRetention: 3,
    });
    const all = repos.snapshots.listByNote('cap');
    expect(all.filter((s) => s.label !== null)).toHaveLength(1);
    expect(all.filter((s) => s.label === null)).toHaveLength(3);
  });
});
