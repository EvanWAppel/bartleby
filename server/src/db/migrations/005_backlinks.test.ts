// D-006: backlinks table — outgoing `[[Note Title]]` references, recomputed
// on every Yjs change (S-009). Inbound lookup is the headline use case.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
}

interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

interface IndexInfo {
  name: string;
}

function seedUserAndNotes(db: import('better-sqlite3').Database, ids: string[]): void {
  db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

  const insertNote = db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const id of ids) {
    insertNote.run(id, id, 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
  }
}

describe('migration 005 backlinks (D-006)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(backlinks)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual([
      'id',
      'link_text',
      'source_note_id',
      'target_note_id',
    ]);

    expect(byName.get('source_note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('target_note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('link_text')).toMatchObject({ type: 'TEXT', notnull: 1 });
  });

  test('FKs cascade from both sides', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(backlinks)`).all() as ForeignKeyInfo[];
    const src = fks.find((f) => f.from === 'source_note_id');
    const tgt = fks.find((f) => f.from === 'target_note_id');
    expect(src).toMatchObject({ table: 'notes', to: 'id', on_delete: 'CASCADE' });
    expect(tgt).toMatchObject({ table: 'notes', to: 'id', on_delete: 'CASCADE' });
  });

  test('indexes on source_note_id and target_note_id (both lookup directions)', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(backlinks)`).all() as IndexInfo[];
    const indexedCols = indexes.map((i) => {
      const cols = db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[];
      return cols.map((c) => c.name).join(',');
    });
    expect(indexedCols).toContain('source_note_id');
    expect(indexedCols).toContain('target_note_id');
  });

  test('inbound query: links from A → B and C → B return both sources for B', ({ db }) => {
    seedUserAndNotes(db, ['A', 'B', 'C']);
    const insertLink = db.prepare(
      `INSERT INTO backlinks (source_note_id, target_note_id, link_text)
       VALUES (?, ?, ?)`,
    );
    insertLink.run('A', 'B', 'B');
    insertLink.run('C', 'B', 'B');
    insertLink.run('A', 'C', 'C');

    const inboundB = db
      .prepare(
        `SELECT source_note_id FROM backlinks WHERE target_note_id = ? ORDER BY source_note_id`,
      )
      .all('B') as { source_note_id: string }[];
    expect(inboundB.map((r) => r.source_note_id)).toEqual(['A', 'C']);
  });

  test('outbound query: links from A return their targets', ({ db }) => {
    seedUserAndNotes(db, ['A', 'B', 'C']);
    const insertLink = db.prepare(
      `INSERT INTO backlinks (source_note_id, target_note_id, link_text)
       VALUES (?, ?, ?)`,
    );
    insertLink.run('A', 'B', 'B');
    insertLink.run('A', 'C', 'C');

    const outboundA = db
      .prepare(
        `SELECT target_note_id FROM backlinks WHERE source_note_id = ? ORDER BY target_note_id`,
      )
      .all('A') as { target_note_id: string }[];
    expect(outboundA.map((r) => r.target_note_id)).toEqual(['B', 'C']);
  });

  test('cascade: deleting the source note removes its outbound links', ({ db }) => {
    seedUserAndNotes(db, ['A', 'B']);
    db.prepare(
      `INSERT INTO backlinks (source_note_id, target_note_id, link_text) VALUES (?, ?, ?)`,
    ).run('A', 'B', 'B');
    db.prepare(`DELETE FROM notes WHERE id = ?`).run('A');

    const count = db.prepare(`SELECT COUNT(*) AS n FROM backlinks`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  test('cascade: deleting the target note removes inbound links', ({ db }) => {
    seedUserAndNotes(db, ['A', 'B']);
    db.prepare(
      `INSERT INTO backlinks (source_note_id, target_note_id, link_text) VALUES (?, ?, ?)`,
    ).run('A', 'B', 'B');
    db.prepare(`DELETE FROM notes WHERE id = ?`).run('B');

    const count = db.prepare(`SELECT COUNT(*) AS n FROM backlinks`).get() as { n: number };
    expect(count.n).toBe(0);
  });
});
