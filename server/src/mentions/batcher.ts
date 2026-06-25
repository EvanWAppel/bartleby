// M-005: in-process per-user sliding-window batcher for mention emails.
//
// Each user (mentioned_user_id) has its own queue and timer. When
// `enqueue(item)` is called:
//   1. Append the item to that user's queue.
//   2. Cancel any pending timer for that user.
//   3. Set a fresh `windowMs` (default 60s) timer that, on fire, drains
//      the queue and hands the accumulated batch to `onSend`.
//
// Sliding window means each enqueue *resets* the timer. So a chatty
// mentioner who hammers @alice over 30s coalesces into one email rather
// than waking her up twice. The 60s grace window is short enough that a
// dropped-then-reopened note save still combines (Hocuspocus debounce
// is sub-second) but long enough that a one-off mention doesn't sit in
// purgatory.
//
// Failure handling: `onSend` callbacks that reject are caught + logged
// here. The caller (email-sender.ts) already does the retry-with-
// backoff; this layer just makes sure one bad batch doesn't take the
// process down.
//
// Shutdown: `flushAll()` cancels every timer and immediately fires
// every queued batch. Wired into the SIGTERM/SIGINT handler in
// index.ts so in-flight batches don't disappear on restart.

import type { Logger } from 'pino';
import type { MentionEmailSource } from './email-template.js';

export interface MentionBatchItem {
  /** mentions.id — the batcher uses these to mark email_sent_at. */
  mentionId: string;
  mentionedUserId: string;
  mentionerName: string;
  mentionerEmail: string;
  recipientName: string;
  recipientEmail: string;
  noteId: string;
  noteTitle: string;
  source: MentionEmailSource;
  snippet: string;
  mentionedAt: string;
}

export type MentionBatch = MentionBatchItem[];

export interface BatcherDeps {
  /** Called once per batch — accumulator of mentions for one user. */
  onSend(batch: MentionBatch): Promise<void>;
  logger: Logger;
  /** Sliding-window length in milliseconds. Default 60_000. */
  windowMs?: number;
  /** Injectable timer pair for tests. Defaults to `globalThis.setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

export interface MentionBatcher {
  /** Append `item` to its recipient's queue; (re)set the 60s timer. */
  enqueue(item: MentionBatchItem): void;
  /** Cancel every timer and synchronously fire every queued batch.
   * Returns when all `onSend` promises settle. */
  flushAll(): Promise<void>;
  /** Number of pending batches (one entry per recipient). For tests. */
  pendingCount(): number;
}

interface PerUserState {
  items: MentionBatchItem[];
  timer: NodeJS.Timeout;
}

const DEFAULT_WINDOW_MS = 60_000;

export function createMentionBatcher(deps: BatcherDeps): MentionBatcher {
  const { onSend, logger } = deps;
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  const queues = new Map<string, PerUserState>();

  async function fireBatch(userId: string): Promise<void> {
    const state = queues.get(userId);
    if (state === undefined) return;
    // Detach the queue before invoking onSend so a new enqueue mid-send
    // starts a fresh window cleanly.
    queues.delete(userId);
    clearTimer(state.timer);
    try {
      await onSend(state.items);
    } catch (err) {
      // The sender owns retry. If we get here, retries have been
      // exhausted (or the call threw synchronously). Log + swallow so
      // the process stays up.
      logger.error(
        {
          mentionedUserId: userId,
          count: state.items.length,
          error: err instanceof Error ? err.message : String(err),
        },
        'mention-batcher: onSend failed after retries — batch dropped',
      );
    }
  }

  return {
    enqueue(item) {
      const existing = queues.get(item.mentionedUserId);
      if (existing !== undefined) {
        clearTimer(existing.timer);
        existing.items.push(item);
        existing.timer = setTimer(() => {
          void fireBatch(item.mentionedUserId);
        }, windowMs);
        return;
      }
      const state: PerUserState = {
        items: [item],
        timer: setTimer(() => {
          void fireBatch(item.mentionedUserId);
        }, windowMs),
      };
      // Don't block process exit on a pending batch — flushAll() runs
      // during graceful shutdown.
      if (typeof state.timer.unref === 'function') {
        state.timer.unref();
      }
      queues.set(item.mentionedUserId, state);
    },

    async flushAll() {
      // Snapshot keys first so deletes mid-iteration don't skip entries.
      const userIds = [...queues.keys()];
      const promises = userIds.map((userId) => fireBatch(userId));
      await Promise.all(promises);
    },

    pendingCount() {
      return queues.size;
    },
  };
}
