import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createBacklinksRepository } from './backlinks.js';
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

describe('BacklinksRepository', () => {
  test('replaceForSource sets links; listOutbound returns them', ({ db }) => {
    seed(db, ['A', 'B', 'C']);
    const repo = createBacklinksRepository(db);
    repo.replaceForSource('A', [
      { target_note_id: 'B', link_text: 'B' },
      { target_note_id: 'C', link_text: 'See C' },
    ]);
    expect(repo.listOutbound('A').map((b) => b.target_note_id)).toEqual(['B', 'C']);
  });

  test('replaceForSource overwrites previous links', ({ db }) => {
    seed(db, ['A', 'B', 'C']);
    const repo = createBacklinksRepository(db);
    repo.replaceForSource('A', [{ target_note_id: 'B', link_text: 'B' }]);
    repo.replaceForSource('A', [{ target_note_id: 'C', link_text: 'C' }]);
    expect(repo.listOutbound('A').map((b) => b.target_note_id)).toEqual(['C']);
  });

  test('listInbound returns sources pointing at a target', ({ db }) => {
    seed(db, ['A', 'B', 'C']);
    const repo = createBacklinksRepository(db);
    repo.replaceForSource('A', [{ target_note_id: 'B', link_text: 'B' }]);
    repo.replaceForSource('C', [{ target_note_id: 'B', link_text: 'B' }]);
    expect(repo.listInbound('B').map((b) => b.source_note_id)).toEqual(['A', 'C']);
  });

  test('link_text is preserved', ({ db }) => {
    seed(db, ['A', 'B']);
    const repo = createBacklinksRepository(db);
    repo.replaceForSource('A', [{ target_note_id: 'B', link_text: 'click here' }]);
    expect(repo.listOutbound('A')[0]?.link_text).toBe('click here');
  });

  test('replaceForSource with empty array clears outbound links', ({ db }) => {
    seed(db, ['A', 'B']);
    const repo = createBacklinksRepository(db);
    repo.replaceForSource('A', [{ target_note_id: 'B', link_text: 'B' }]);
    repo.replaceForSource('A', []);
    expect(repo.listOutbound('A')).toEqual([]);
  });

  test('unrelated note: listInbound for an unlinked target is empty', ({ db }) => {
    seed(db, ['A']);
    const repo = createBacklinksRepository(db);
    expect(repo.listInbound('A')).toEqual([]);
  });
});
