import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createNotesRepository } from './notes.js';
import { createUsersRepository } from './users.js';

function seedUser(db: import('better-sqlite3').Database): void {
  createUsersRepository(db).insert({
    id: 'u1',
    email: 'a@a.a',
    display_name: 'a',
    color: '#fff',
    created_at: '2026-05-23T00:00:00.000Z',
  });
}

function baseNote(
  id: string,
  title = 't',
): {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  markdown_export: string;
} {
  return {
    id,
    title,
    created_by: 'u1',
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    trashed_at: null,
    markdown_export: '',
  };
}

describe('NotesRepository', () => {
  test('insert + findById round-trip', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    const n = baseNote('n1');
    repo.insert(n);
    expect(repo.findById('n1')).toEqual(n);
  });

  test('findById returns undefined for unknown id', ({ db }) => {
    expect(createNotesRepository(db).findById('nope')).toBeUndefined();
  });

  test('listLive / listTrashed partition by trashed_at', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n1', 'live'));
    repo.insert({ ...baseNote('n2', 'trash'), trashed_at: '2026-05-23T00:01:00.000Z' });

    expect(repo.listLive().map((n) => n.id)).toEqual(['n1']);
    expect(repo.listTrashed().map((n) => n.id)).toEqual(['n2']);
  });

  test('listLive sorts by updated_at DESC', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert({ ...baseNote('n1'), updated_at: '2026-05-23T01:00:00.000Z' });
    repo.insert({ ...baseNote('n2'), updated_at: '2026-05-23T02:00:00.000Z' });
    expect(repo.listLive().map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  test('updateTitle changes title and updated_at', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n1', 'old'));
    repo.updateTitle('n1', 'new', '2026-05-23T05:00:00.000Z');
    const row = repo.findById('n1');
    expect(row?.title).toBe('new');
    expect(row?.updated_at).toBe('2026-05-23T05:00:00.000Z');
  });

  test('updateMarkdownExport changes body + updated_at', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n1'));
    repo.updateMarkdownExport('n1', '# new', '2026-05-23T05:00:00.000Z');
    const row = repo.findById('n1');
    expect(row?.markdown_export).toBe('# new');
    expect(row?.updated_at).toBe('2026-05-23T05:00:00.000Z');
  });

  test('softDelete + restore round-trip', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n1'));
    repo.softDelete('n1', '2026-05-23T05:00:00.000Z');
    expect(repo.findById('n1')?.trashed_at).toBe('2026-05-23T05:00:00.000Z');
    repo.restore('n1');
    expect(repo.findById('n1')?.trashed_at).toBeNull();
  });

  test('hardDelete removes the row', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n1'));
    repo.hardDelete('n1');
    expect(repo.findById('n1')).toBeUndefined();
  });

  test('purgeOlderThan returns deleted ids and only purges trashed-and-older', ({ db }) => {
    seedUser(db);
    const repo = createNotesRepository(db);
    repo.insert(baseNote('n-live'));
    repo.insert({ ...baseNote('n-old'), trashed_at: '2026-04-01T00:00:00.000Z' });
    repo.insert({ ...baseNote('n-new'), trashed_at: '2026-05-22T00:00:00.000Z' });

    const purged = repo.purgeOlderThan('2026-05-01T00:00:00.000Z');
    expect(purged).toEqual(['n-old']);
    expect(repo.findById('n-old')).toBeUndefined();
    expect(repo.findById('n-new')).toBeDefined();
    expect(repo.findById('n-live')).toBeDefined();
  });
});
