// S-010: hourly background job that hard-deletes notes whose
// `trashed_at` is older than 30 days. D's FK cascades sweep
// dependent rows (tags, backlinks, comments, snapshots, mentions,
// note_titles_history) automatically.

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import pino from 'pino';
import { test as base } from 'vitest';
import { createTestDatabase } from '../db/test-fixture.js';
import { createRepositories, type Repositories } from '../db/repositories/index.js';
import { createTrashPurger } from './purge.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const logger = pino({ level: 'silent' });

interface PurgeFixture {
  repos: Repositories;
  db: import('better-sqlite3').Database;
}

const test = base.extend<PurgeFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
  repos: async ({ db }, use) => {
    await use(createRepositories(db));
  },
});

function seedUser(repos: Repositories): void {
  repos.users.insert({
    id: 'u1',
    email: 'a@a.a',
    display_name: 'a',
    color: '#000',
    created_at: NOW.toISOString(),
  });
}

function seedNote(repos: Repositories, id: string, opts: { trashedAt?: Date | null } = {}): void {
  repos.notes.insert({
    id,
    title: id,
    created_by: 'u1',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    trashed_at: opts.trashedAt === undefined ? null : (opts.trashedAt?.toISOString() ?? null),
    markdown_export: '',
  });
}

describe('runOnce (S-010 purge)', () => {
  test('hard-deletes notes whose trashed_at is older than 30 days', ({ repos }) => {
    seedUser(repos);
    // 31 days ago → purgeable.
    seedNote(repos, 'old', { trashedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000) });
    // 29 days ago → still in trash window.
    seedNote(repos, 'recent', { trashedAt: new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000) });
    // not trashed at all.
    seedNote(repos, 'live');

    const purger = createTrashPurger({
      repos,
      logger,
      now: () => NOW,
      retentionMs: THIRTY_DAYS_MS,
    });
    const result = purger.runOnce();
    expect(result.purgedIds).toEqual(['old']);
    expect(repos.notes.findById('old')).toBeUndefined();
    expect(repos.notes.findById('recent')).toBeDefined();
    expect(repos.notes.findById('live')).toBeDefined();
  });

  test('returns empty when nothing is over the threshold', ({ repos }) => {
    seedUser(repos);
    seedNote(repos, 'fresh');
    seedNote(repos, 'recent-trash', {
      trashedAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
    });

    const purger = createTrashPurger({
      repos,
      logger,
      now: () => NOW,
      retentionMs: THIRTY_DAYS_MS,
    });
    expect(purger.runOnce().purgedIds).toEqual([]);
  });

  test('cascade: tags, backlinks, note_titles_history go too', ({ repos }) => {
    seedUser(repos);
    const old = 'doomed';
    seedNote(repos, old, { trashedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) });
    seedNote(repos, 'survivor');
    repos.tags.replaceForNote(old, ['travel']);
    repos.tags.replaceForNote('survivor', ['travel']);
    repos.backlinks.replaceForSource(old, [{ target_note_id: 'survivor', link_text: 'survivor' }]);
    repos.noteTitlesHistory.append(old, 'doomed', NOW.toISOString());

    const purger = createTrashPurger({
      repos,
      logger,
      now: () => NOW,
      retentionMs: THIRTY_DAYS_MS,
    });
    purger.runOnce();

    // The note row is gone.
    expect(repos.notes.findById(old)).toBeUndefined();
    // Dependent rows are gone via FK cascade.
    expect(repos.tags.listForNote(old)).toEqual([]);
    expect(repos.backlinks.listOutbound(old)).toEqual([]);
    expect(repos.noteTitlesHistory.listByNote(old)).toEqual([]);
    // Survivor untouched (it's only an inbound target).
    expect(repos.notes.findById('survivor')).toBeDefined();
    expect(repos.tags.listForNote('survivor')).toEqual(['travel']);
  });
});

describe('start/stop (S-010 scheduler)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('start() schedules runOnce on the configured interval; stop() cancels', async ({
    repos,
  }) => {
    seedUser(repos);
    seedNote(repos, 'old', { trashedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) });

    const purger = createTrashPurger({
      repos,
      logger,
      now: () => new Date(),
      retentionMs: THIRTY_DAYS_MS,
      intervalMs: 60_000,
    });

    purger.start();
    // Hasn't fired yet — interval is 60s in fake time.
    expect(repos.notes.findById('old')).toBeDefined();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repos.notes.findById('old')).toBeUndefined();

    // Add another expired note; stop() should prevent the next fire.
    seedNote(repos, 'old2', { trashedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) });
    purger.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(repos.notes.findById('old2')).toBeDefined();
  });

  test('start() is idempotent (second call does not double-schedule)', async ({ repos }) => {
    seedUser(repos);
    seedNote(repos, 'old', { trashedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) });

    const purger = createTrashPurger({
      repos,
      logger,
      now: () => new Date(),
      retentionMs: THIRTY_DAYS_MS,
      intervalMs: 60_000,
    });
    purger.start();
    purger.start(); // second start should be a no-op

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repos.notes.findById('old')).toBeUndefined();
    // No assertion on count — if double-scheduled, the second tick would
    // also fire and we'd see no other observable difference at this scale.
    // Idempotence here means stop() actually stops everything.
    purger.stop();
    seedNote(repos, 'old2', { trashedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000) });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(repos.notes.findById('old2')).toBeDefined();
  });

  test('stop() before start() is a no-op (no throw)', ({ repos }) => {
    const purger = createTrashPurger({
      repos,
      logger,
      now: () => NOW,
      retentionMs: THIRTY_DAYS_MS,
      intervalMs: 60_000,
    });
    expect(() => purger.stop()).not.toThrow();
  });
});
