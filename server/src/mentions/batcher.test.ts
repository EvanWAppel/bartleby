// M-005: in-process per-user sliding-window batcher for mention emails.
//
// Sliding window semantics — each enqueue *resets* a 60s timer. So 3
// enqueues within 30s of each other fire one email; 2 enqueues 90s
// apart fire two emails. This is the spec's required behaviour:
//   3 mentions in 30s → 1 send with 3 items
//   2 mentions 90s apart → 2 sends

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { createMentionBatcher, type MentionBatch, type BatcherDeps } from './batcher.js';

const SILENT_LOGGER = pino({ level: 'silent' });

const ALICE_ID = 'u-alice';
const BOB_ID = 'u-bob';

function mention(id: string, mentionedUserId = ALICE_ID): MentionBatch[number] {
  return {
    mentionId: id,
    mentionedUserId,
    mentionerName: 'Bob',
    mentionerEmail: 'bob@example.com',
    recipientName: 'Alice',
    recipientEmail: 'alice@example.com',
    noteId: `note-${id}`,
    noteTitle: `Note ${id}`,
    source: 'note',
    snippet: `mention ${id}`,
    mentionedAt: new Date().toISOString(),
  };
}

function buildBatcher(
  send: BatcherDeps['onSend'],
  overrides: Partial<BatcherDeps> = {},
): ReturnType<typeof createMentionBatcher> {
  return createMentionBatcher({
    onSend: send,
    logger: SILENT_LOGGER,
    windowMs: 60_000,
    ...overrides,
  });
}

describe('createMentionBatcher (M-005, sliding window)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('3 mentions within 30s → 1 send with 3 items', async () => {
    const sendSpy = vi.fn<BatcherDeps['onSend']>().mockResolvedValue();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('m1'));
    await vi.advanceTimersByTimeAsync(20_000);
    batcher.enqueue(mention('m2'));
    await vi.advanceTimersByTimeAsync(20_000);
    batcher.enqueue(mention('m3'));
    // 60s has not elapsed since m3.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sendSpy).not.toHaveBeenCalled();
    // Now finish the window.
    await vi.advanceTimersByTimeAsync(45_000);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const batch = sendSpy.mock.calls[0]![0];
    expect(batch.map((m) => m.mentionId)).toEqual(['m1', 'm2', 'm3']);
  });

  test('2 mentions 90s apart → 2 separate sends', async () => {
    const sendSpy = vi.fn<BatcherDeps['onSend']>().mockResolvedValue();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('m1'));
    // After 60s the first timer fires with just m1.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0].map((m) => m.mentionId)).toEqual(['m1']);

    // 30s after that (= 90s after m1) m2 arrives — schedules its own send.
    await vi.advanceTimersByTimeAsync(30_000);
    batcher.enqueue(mention('m2'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]![0].map((m) => m.mentionId)).toEqual(['m2']);
  });

  test('mentions to different users are batched independently', async () => {
    const sendSpy = vi.fn<BatcherDeps['onSend']>().mockResolvedValue();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('to-alice', ALICE_ID));
    batcher.enqueue(mention('to-bob', BOB_ID));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((c) => c[0][0]!.mentionedUserId).sort();
    expect(recipients).toEqual([ALICE_ID, BOB_ID]);
  });

  test('flushAll() sends every pending batch immediately', async () => {
    const sendSpy = vi.fn<BatcherDeps['onSend']>().mockResolvedValue();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('m1', ALICE_ID));
    batcher.enqueue(mention('m2', BOB_ID));
    await batcher.flushAll();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    // The queues are drained — advancing past the original window
    // doesn't trigger anything else.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  test('errors in onSend are caught and do not crash the batcher', async () => {
    const sendSpy = vi
      .fn<BatcherDeps['onSend']>()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('m1'));
    await vi.advanceTimersByTimeAsync(60_000);
    // The error from the first send shouldn't poison subsequent enqueues.
    batcher.enqueue(mention('m2'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  test('enqueueing after a flush opens a fresh window', async () => {
    const sendSpy = vi.fn<BatcherDeps['onSend']>().mockResolvedValue();
    const batcher = buildBatcher(sendSpy);

    batcher.enqueue(mention('m1'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    batcher.enqueue(mention('m2'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });
});
