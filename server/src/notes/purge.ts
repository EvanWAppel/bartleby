// S-010: hourly background job that hard-deletes notes whose
// `trashed_at` is older than the retention window (PRD §9.3 = 30 days).
//
// The actual SQL lives in D's notes.purgeOlderThan; this module owns
// the scheduler + the cutoff math + the logging. All dependent rows
// (tags, backlinks, comments, snapshots, mentions,
// note_titles_history) cascade automatically via the FKs D set up.

import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories/index.js';

export interface TrashPurgerOptions {
  repos: Repositories;
  logger: Logger;
  /** Injectable clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** How long a trashed note lives. Default 30 days. */
  retentionMs?: number;
  /** How often the scheduler fires. Default 1 hour. */
  intervalMs?: number;
}

export interface TrashPurger {
  /** Run one purge synchronously and return the ids that were deleted. */
  runOnce(): { purgedIds: string[] };
  /** Start the recurring scheduler. Idempotent. */
  start(): void;
  /** Cancel the scheduler. Safe to call before start() or twice. */
  stop(): void;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export function createTrashPurger(options: TrashPurgerOptions): TrashPurger {
  const { repos, logger } = options;
  const now = options.now ?? (() => new Date());
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let handle: ReturnType<typeof setInterval> | null = null;

  function runOnce(): { purgedIds: string[] } {
    const cutoff = new Date(now().getTime() - retentionMs).toISOString();
    const purgedIds = repos.notes.purgeOlderThan(cutoff);
    if (purgedIds.length > 0) {
      logger.info({ count: purgedIds.length, cutoff }, 'trash-purge: deleted');
    } else {
      logger.debug({ cutoff }, 'trash-purge: nothing to delete');
    }
    return { purgedIds };
  }

  return {
    runOnce,
    start() {
      if (handle !== null) return;
      handle = setInterval(runOnce, intervalMs);
      // Don't block process exit on this timer.
      if (typeof handle.unref === 'function') {
        handle.unref();
      }
      logger.info({ intervalMs, retentionMs }, 'trash-purge: scheduler started');
    },
    stop() {
      if (handle === null) return;
      clearInterval(handle);
      handle = null;
      logger.info('trash-purge: scheduler stopped');
    },
  };
}
