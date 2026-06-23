// C-008: comments.is_orphaned column for orphan detection.
//
// Stored as INTEGER (0/1) — SQLite's BOOLEAN-by-convention. Defaults to
// 0 so existing rows and new inserts that haven't been recomputed yet
// are treated as anchored. The S-009 hook recomputes the flag for every
// comment on the note after each persistence pass.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

describe('migration 010 comments.is_orphaned (C-008)', () => {
  test('schema: is_orphaned column exists, NOT NULL, default 0', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(comments)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.has('is_orphaned')).toBe(true);
    const col = byName.get('is_orphaned')!;
    expect(col.type).toBe('INTEGER');
    expect(col.notnull).toBe(1);
    expect(col.dflt_value).toBe('0');
  });

  test('existing/new rows default to is_orphaned=0', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'a@a.a', 'a', '#000', '2026-05-23T00:00:00.000Z');
    db.prepare(
      `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('n1', 't', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
    db.prepare(
      `INSERT INTO comments (id, note_id, author_id, parent_comment_id,
                             anchor, original_quote, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('c1', 'n1', 'u1', null, '{}', 'q', 'first', '2026-05-23T00:00:00.000Z');

    const row = db.prepare(`SELECT is_orphaned FROM comments WHERE id = ?`).get('c1') as {
      is_orphaned: number;
    };
    expect(row.is_orphaned).toBe(0);
  });
});
