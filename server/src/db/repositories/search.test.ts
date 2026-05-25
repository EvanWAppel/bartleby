import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createSearchRepository } from './search.js';
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
}

function insertNote(
  db: import('better-sqlite3').Database,
  id: string,
  title: string,
  markdown: string,
  trashed = false,
): void {
  createNotesRepository(db).insert({
    id,
    title,
    created_by: 'u1',
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    trashed_at: trashed ? '2026-05-23T00:01:00.000Z' : null,
    markdown_export: markdown,
  });
}

describe('SearchRepository', () => {
  test('searchNotes finds matches in title and body', ({ db }) => {
    seed(db);
    insertNote(db, 'n1', 'Trip to Spain', 'Madrid food list');

    const search = createSearchRepository(db);
    expect(search.searchNotes('Spain').map((h) => h.id)).toEqual(['n1']);
    expect(search.searchNotes('Madrid').map((h) => h.id)).toEqual(['n1']);
  });

  test('searchNotes excludes trashed notes', ({ db }) => {
    seed(db);
    insertNote(db, 'n1', 'live', 'pangolin');
    insertNote(db, 'n2', 'trashed', 'pangolin', true);

    const search = createSearchRepository(db);
    expect(search.searchNotes('pangolin').map((h) => h.id)).toEqual(['n1']);
  });

  test('searchNotes returns snippet with highlight marks', ({ db }) => {
    seed(db);
    insertNote(db, 'n1', 'A', 'The quick brown pangolin jumped over the lazy aardvark');

    const search = createSearchRepository(db);
    const [hit] = search.searchNotes('pangolin');
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain('<mark>pangolin</mark>');
  });

  test('searchNotes respects limit and offset', ({ db }) => {
    seed(db);
    for (let i = 0; i < 5; i++) {
      insertNote(db, `n${i}`, `note ${i}`, 'sharedkeyword');
    }
    const search = createSearchRepository(db);
    expect(search.searchNotes('sharedkeyword', { limit: 2, offset: 0 })).toHaveLength(2);
    expect(search.searchNotes('sharedkeyword', { limit: 2, offset: 2 })).toHaveLength(2);
    expect(search.searchNotes('sharedkeyword', { limit: 2, offset: 4 })).toHaveLength(1);
  });

  test('searchNotes returns empty list for no matches', ({ db }) => {
    seed(db);
    insertNote(db, 'n1', 'A', 'body');
    expect(createSearchRepository(db).searchNotes('zzznothing')).toEqual([]);
  });
});
