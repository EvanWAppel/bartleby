// C-002: auto-snapshot scheduler.
//
// Per the PRD: "per note, every ~5 min, if doc changed since last
// snapshot, write an unlabeled snapshot row." We implement this as a
// `tickAutoSnapshots()` function that walks every non-trashed note,
// checks whether it's been edited since its most recent snapshot, and
// writes one if so. A `setInterval` wrapper kicks it on a 5-minute
// cadence in production; tests call `tickAutoSnapshots` directly with
// a pinned clock.
//
// "Changed since last snapshot" is established by comparing
// `notes.updated_at` (maintained by the S-009 derived-state hook on
// every doc save) to the latest snapshot's `created_at`. If there is
// no prior snapshot AND the note has content, we snapshot. If the
// note hasn't been touched since the last snapshot, we skip.
//
// Retention (C-005) runs in-tick: after every fresh auto-snapshot
// insert we prune auto-snapshots beyond the most recent 50 for that
// note. Named snapshots are exempt (the repo's prune already filters
// `WHERE label IS NULL`).

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories/index.js';
import type { YjsDocAccessor } from './yjs-access.js';

export interface AutoSnapshotDeps {
  repos: Repositories;
  yjs: YjsDocAccessor;
  /** Injectable clock; tests pin this. */
  now?: () => Date;
  /** C-005 retention; default 50. */
  autoSnapshotRetention?: number;
  logger?: Logger;
}

export interface TickResult {
  /** Number of notes that received a fresh auto-snapshot on this tick. */
  created: number;
  /** Number of notes that were considered and skipped (no change). */
  skipped: number;
}

/**
 * Walk every non-trashed note. For each:
 *   - find the most-recent snapshot (auto OR named).
 *   - if `notes.updated_at > snapshot.created_at` (or no snapshot at
 *     all and the note has content), grab the current Yjs state and
 *     write a new auto-snapshot row.
 *   - prune auto-snapshots beyond the retention cap.
 */
export async function tickAutoSnapshots(deps: AutoSnapshotDeps): Promise<TickResult> {
  const { repos, yjs, logger } = deps;
  const retention = deps.autoSnapshotRetention ?? 50;
  const now = (deps.now ?? (() => new Date()))().toISOString();

  let created = 0;
  let skipped = 0;
  // listAll() returns trashed + active rows; the scheduler is only
  // interested in live notes — trashed ones will be hard-deleted by
  // the S-010 purger and their snapshots cascade-deleted via the FK,
  // so spending Yjs round-trips on them is pure waste.
  const notes = repos.notes.listAll().filter((n) => n.trashed_at === null);
  for (const note of notes) {
    // Most-recent snapshot of any kind (named OR auto). If it's
    // newer than the note's updated_at, nothing to snapshot.
    const latest = repos.snapshots.listByNote(note.id, { limit: 1 });
    const lastSnapAt = latest[0]?.created_at;
    if (lastSnapAt !== undefined && lastSnapAt >= note.updated_at) {
      skipped += 1;
      continue;
    }
    // Otherwise, encode current state and write.
    const encoded = await yjs.read(note.id);
    repos.snapshots.insert({
      id: randomUUID(),
      note_id: note.id,
      yjs_state: Buffer.from(encoded),
      created_at: now,
      label: null,
    });
    repos.snapshots.pruneAutoSnapshots(note.id, retention);
    created += 1;
  }
  logger?.debug({ created, skipped }, 'snapshot scheduler tick');
  return { created, skipped };
}

export interface SnapshotScheduler {
  start(): void;
  stop(): void;
}

/** Wraps tickAutoSnapshots in a setInterval. The timer is unref'd so
 * pending ticks don't keep the process alive at shutdown. Failures
 * inside a tick are logged and swallowed — a single bad note shouldn't
 * stop the next interval from running. */
export function createAutoSnapshotScheduler(
  deps: AutoSnapshotDeps & { intervalMs?: number },
): SnapshotScheduler {
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  let handle: NodeJS.Timeout | null = null;
  return {
    start(): void {
      if (handle !== null) return;
      handle = setInterval(() => {
        tickAutoSnapshots(deps).catch((err) => {
          deps.logger?.error({ err }, 'snapshot scheduler tick failed');
        });
      }, intervalMs);
      handle.unref();
    },
    stop(): void {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}
