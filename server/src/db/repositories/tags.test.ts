import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createTagsRepository } from './tags.js';
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

describe('TagsRepository', () => {
  test('replaceForNote sets the tag set; listForNote returns them sorted', ({ db }) => {
    seed(db, ['n1']);
    const repo = createTagsRepository(db);
    repo.replaceForNote('n1', ['travel', 'reading', 'cooking']);
    expect(repo.listForNote('n1')).toEqual(['cooking', 'reading', 'travel']);
  });

  test('replaceForNote overwrites previous tags', ({ db }) => {
    seed(db, ['n1']);
    const repo = createTagsRepository(db);
    repo.replaceForNote('n1', ['travel', 'reading']);
    repo.replaceForNote('n1', ['cooking']);
    expect(repo.listForNote('n1')).toEqual(['cooking']);
  });

  test('replaceForNote dedupes duplicate input tags', ({ db }) => {
    seed(db, ['n1']);
    const repo = createTagsRepository(db);
    repo.replaceForNote('n1', ['travel', 'travel', 'reading']);
    expect(repo.listForNote('n1')).toEqual(['reading', 'travel']);
  });

  test('listNotesByTag returns matching notes', ({ db }) => {
    seed(db, ['n1', 'n2', 'n3']);
    const repo = createTagsRepository(db);
    repo.replaceForNote('n1', ['travel']);
    repo.replaceForNote('n2', ['travel', 'reading']);
    repo.replaceForNote('n3', ['cooking']);

    expect(repo.listNotesByTag('travel')).toEqual(['n1', 'n2']);
    expect(repo.listNotesByTag('reading')).toEqual(['n2']);
    expect(repo.listNotesByTag('unknown')).toEqual([]);
  });

  test('replaceForNote with empty array clears tags', ({ db }) => {
    seed(db, ['n1']);
    const repo = createTagsRepository(db);
    repo.replaceForNote('n1', ['travel']);
    repo.replaceForNote('n1', []);
    expect(repo.listForNote('n1')).toEqual([]);
  });
});
