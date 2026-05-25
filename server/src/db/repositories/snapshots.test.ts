import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createSnapshotsRepository } from './snapshots.js';
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

function snap(
  id: string,
  createdAt: string,
  label: string | null = null,
  bytes: number[] = [1],
): {
  id: string;
  note_id: string;
  yjs_state: Buffer;
  created_at: string;
  label: string | null;
} {
  return {
    id,
    note_id: 'n1',
    yjs_state: Buffer.from(bytes),
    created_at: createdAt,
    label,
  };
}

describe('SnapshotsRepository', () => {
  test('insert + findById preserves yjs_state binary', ({ db }) => {
    seed(db);
    const repo = createSnapshotsRepository(db);
    const original = Buffer.from([0, 1, 2, 255, 128, 64]);
    repo.insert(snap('s1', '2026-05-23T00:00:00.000Z', null, [0, 1, 2, 255, 128, 64]));
    const row = repo.findById('s1');
    expect(row).toBeDefined();
    expect(Buffer.compare(row!.yjs_state, original)).toBe(0);
    expect(row!.label).toBeNull();
  });

  test('listByNote returns newest-first', ({ db }) => {
    seed(db);
    const repo = createSnapshotsRepository(db);
    repo.insert(snap('s1', '2026-05-23T00:00:00.000Z'));
    repo.insert(snap('s2', '2026-05-23T00:05:00.000Z', 'named'));
    repo.insert(snap('s3', '2026-05-23T00:10:00.000Z'));

    expect(repo.listByNote('n1').map((s) => s.id)).toEqual(['s3', 's2', 's1']);
  });

  test('listByNote pagination', ({ db }) => {
    seed(db);
    const repo = createSnapshotsRepository(db);
    for (let i = 0; i < 5; i++) {
      repo.insert(snap(`s${i}`, `2026-05-23T00:0${i}:00.000Z`));
    }
    const page = repo.listByNote('n1', { limit: 2, offset: 1 });
    expect(page.map((s) => s.id)).toEqual(['s3', 's2']);
  });

  test('pruneAutoSnapshots keeps named snapshots and the N most recent autos', ({ db }) => {
    seed(db);
    const repo = createSnapshotsRepository(db);
    // 6 auto snapshots in chronological order; keep most recent 3.
    for (let i = 0; i < 6; i++) {
      repo.insert(snap(`auto-${i}`, `2026-05-23T00:0${i}:00.000Z`, null));
    }
    // 2 named snapshots interleaved.
    repo.insert(snap('named-a', '2026-05-23T00:01:30.000Z', 'a'));
    repo.insert(snap('named-b', '2026-05-23T00:03:30.000Z', 'b'));

    const purged = repo.pruneAutoSnapshots('n1', 3);
    expect(purged).toBe(3);

    const ids = repo.listByNote('n1').map((s) => s.id);
    // The 3 newest auto rows survive (auto-5, auto-4, auto-3); auto-0..2 gone.
    expect(ids).toContain('auto-5');
    expect(ids).toContain('auto-4');
    expect(ids).toContain('auto-3');
    expect(ids).not.toContain('auto-0');
    expect(ids).not.toContain('auto-1');
    expect(ids).not.toContain('auto-2');
    // Named always survive.
    expect(ids).toContain('named-a');
    expect(ids).toContain('named-b');
  });

  test('pruneAutoSnapshots is a no-op when under the limit', ({ db }) => {
    seed(db);
    const repo = createSnapshotsRepository(db);
    repo.insert(snap('a', '2026-05-23T00:00:00.000Z'));
    expect(repo.pruneAutoSnapshots('n1', 50)).toBe(0);
    expect(repo.listByNote('n1')).toHaveLength(1);
  });
});
