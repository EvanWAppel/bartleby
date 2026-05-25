import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createNoteTitlesHistoryRepository } from './note-titles-history.js';
import { createNotesRepository } from './notes.js';
import { createUsersRepository } from './users.js';

function seed(db: import('better-sqlite3').Database, noteIds: string[]): void {
  createUsersRepository(db).insert({
    id: 'u1',
    email: 'a@a.a',
    display_name: 'a',
    color: '#fff',
    created_at: '2026-05-23T00:00:00.000Z',
  });
  const notes = createNotesRepository(db);
  for (const id of noteIds) {
    notes.insert({
      id,
      title: id,
      created_by: 'u1',
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
      trashed_at: null,
      markdown_export: '',
    });
  }
}

describe('NoteTitlesHistoryRepository', () => {
  test('append: first call leaves an open interval', ({ db }) => {
    seed(db, ['n1']);
    const repo = createNoteTitlesHistoryRepository(db);
    repo.append('n1', 'first', '2026-05-23T00:00:00.000Z');
    const rows = repo.listByNote('n1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('first');
    expect(rows[0]!.valid_to).toBeNull();
  });

  test('append: subsequent call closes the previous interval and opens a new one', ({ db }) => {
    seed(db, ['n1']);
    const repo = createNoteTitlesHistoryRepository(db);
    repo.append('n1', 'first', '2026-05-23T00:00:00.000Z');
    repo.append('n1', 'second', '2026-05-23T00:30:00.000Z');

    const rows = repo.listByNote('n1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: 'first', valid_to: '2026-05-23T00:30:00.000Z' });
    expect(rows[1]).toMatchObject({ title: 'second', valid_to: null });
  });

  test('resolveTitle: current title resolves with is_current=true', ({ db }) => {
    seed(db, ['n1']);
    const repo = createNoteTitlesHistoryRepository(db);
    repo.append('n1', 'first', '2026-05-23T00:00:00.000Z');
    expect(repo.resolveTitle('first')).toEqual([{ note_id: 'n1', is_current: true }]);
  });

  test('resolveTitle: old title resolves with is_current=false', ({ db }) => {
    seed(db, ['n1']);
    const repo = createNoteTitlesHistoryRepository(db);
    repo.append('n1', 'first', '2026-05-23T00:00:00.000Z');
    repo.append('n1', 'second', '2026-05-23T00:30:00.000Z');
    expect(repo.resolveTitle('first')).toEqual([{ note_id: 'n1', is_current: false }]);
  });

  test('resolveTitle: returns multiple notes when title is ambiguous (current first)', ({ db }) => {
    seed(db, ['n1', 'n2']);
    const repo = createNoteTitlesHistoryRepository(db);
    repo.append('n1', 'shared', '2026-05-23T00:00:00.000Z');
    repo.append('n1', 'renamed', '2026-05-23T00:30:00.000Z');
    repo.append('n2', 'shared', '2026-05-23T00:35:00.000Z');

    const resolved = repo.resolveTitle('shared');
    expect(resolved).toEqual([
      { note_id: 'n2', is_current: true },
      { note_id: 'n1', is_current: false },
    ]);
  });

  test('resolveTitle: unknown title returns empty list', ({ db }) => {
    expect(createNoteTitlesHistoryRepository(db).resolveTitle('nope')).toEqual([]);
  });
});
