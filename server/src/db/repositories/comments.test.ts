import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createCommentsRepository } from './comments.js';
import { createNotesRepository } from './notes.js';
import { createUsersRepository } from './users.js';

function seed(db: import('better-sqlite3').Database): void {
  createUsersRepository(db).insert({
    id: 'u1',
    email: 'a@a.a',
    display_name: 'a',
    color: '#fff',
    created_at: '2026-05-23T00:00:00.000Z',
  });
  createNotesRepository(db).insert({
    id: 'n1',
    title: 't',
    created_by: 'u1',
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    trashed_at: null,
    markdown_export: '',
  });
}

const baseComment = {
  note_id: 'n1',
  author_id: 'u1',
  parent_comment_id: null,
  anchor: '{}',
  original_quote: 'q',
  body: 'first',
  created_at: '2026-05-23T00:00:00.000Z',
};

describe('CommentsRepository', () => {
  test('insert + findById round-trip; resolved_at starts null', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    const created = repo.insert({ ...baseComment, id: 'c1' });
    expect(created.resolved_at).toBeNull();
    expect(repo.findById('c1')).toEqual(created);
  });

  test('listByNote default excludes resolved', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.insert({ ...baseComment, id: 'c2', created_at: '2026-05-23T00:01:00.000Z' });
    repo.resolve('c1', '2026-05-23T00:02:00.000Z');

    expect(repo.listByNote('n1').map((c) => c.id)).toEqual(['c2']);
    expect(repo.listByNote('n1', { includeResolved: true }).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  test('resolve + reopen round-trip', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.resolve('c1', '2026-05-23T00:02:00.000Z');
    expect(repo.findById('c1')?.resolved_at).toBe('2026-05-23T00:02:00.000Z');
    repo.reopen('c1');
    expect(repo.findById('c1')?.resolved_at).toBeNull();
  });

  test('insert with parent: reply shows up under parent', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.insert({
      ...baseComment,
      id: 'c2',
      parent_comment_id: 'c1',
      body: 'reply',
      created_at: '2026-05-23T00:01:00.000Z',
    });
    const replies = repo.listByNote('n1').filter((c) => c.parent_comment_id === 'c1');
    expect(replies.map((r) => r.id)).toEqual(['c2']);
  });

  test('delete removes the row', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.delete('c1');
    expect(repo.findById('c1')).toBeUndefined();
  });

  test('C-008: new rows start with is_orphaned=false', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    const row = repo.insert({ ...baseComment, id: 'c1' });
    expect(row.is_orphaned).toBe(false);
  });

  test('C-008: setOrphaned toggles the flag (true/false) and findById reflects it', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });

    repo.setOrphaned('c1', true);
    expect(repo.findById('c1')?.is_orphaned).toBe(true);

    repo.setOrphaned('c1', false);
    expect(repo.findById('c1')?.is_orphaned).toBe(false);
  });

  test('C-008: listAllByNote returns rows regardless of resolved_at', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.insert({ ...baseComment, id: 'c2', created_at: '2026-05-23T00:01:00.000Z' });
    repo.resolve('c1', '2026-05-23T00:02:00.000Z');

    expect(
      repo
        .listAllByNote('n1')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['c1', 'c2']);
  });

  test('C-008: is_orphaned round-trips through listByNote as a boolean (not an int)', ({ db }) => {
    seed(db);
    const repo = createCommentsRepository(db);
    repo.insert({ ...baseComment, id: 'c1' });
    repo.setOrphaned('c1', true);

    const rows = repo.listByNote('n1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_orphaned).toBe(true);
    // Specifically: not the SQLite int 1.
    expect(typeof rows[0]?.is_orphaned).toBe('boolean');
  });
});
