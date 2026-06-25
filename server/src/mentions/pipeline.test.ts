// Integration: the pipeline glues the batcher + sender + template + DB
// together. Tests that enqueueing a mention row triggers a render +
// send and marks `email_sent_at` on the underlying mention rows.

import { describe, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { test as dbTest } from '../db/test-fixture.js';
import { createRepositories } from '../db/repositories/index.js';
import { createMentionEmailPipeline, type MentionEmailPipelineDeps } from './pipeline.js';
import type { EmailTransport } from './email-sender.js';
import type { MentionRow } from '../db/repositories/index.js';

const SILENT_LOGGER = pino({ level: 'silent' });
const PUBLIC_BASE_URL = 'https://bartleby.example';
const FROM = 'mentions@bartleby.example';

function seedUserAndNote(
  db: import('better-sqlite3').Database,
  opts: {
    aliceId: string;
    bobId: string;
    noteId: string;
    noteTitle: string;
    body?: string;
  },
): { alice: { id: string; email: string }; mention: MentionRow } {
  const repos = createRepositories(db);
  repos.users.insert({
    id: opts.aliceId,
    email: 'alice@example.com',
    display_name: 'Alice',
    color: '#aaa',
    created_at: '2026-06-22T11:00:00.000Z',
  });
  repos.users.insert({
    id: opts.bobId,
    email: 'bob@example.com',
    display_name: 'Bob',
    color: '#bbb',
    created_at: '2026-06-22T11:00:00.000Z',
  });
  repos.notes.insert({
    id: opts.noteId,
    title: opts.noteTitle,
    created_by: opts.bobId,
    created_at: '2026-06-22T11:00:00.000Z',
    updated_at: '2026-06-22T11:00:00.000Z',
    trashed_at: null,
    markdown_export: opts.body ?? 'hey @alice@example.com take a look',
  });
  const mention = repos.mentions.insert({
    id: 'mention-1',
    note_id: opts.noteId,
    mentioned_user_id: opts.aliceId,
    mentioning_user_id: opts.bobId,
    source: `note:${opts.noteId}`,
    created_at: '2026-06-22T12:00:00.000Z',
  });
  return { alice: { id: opts.aliceId, email: 'alice@example.com' }, mention };
}

function buildPipeline(
  db: import('better-sqlite3').Database,
  transport: EmailTransport,
  overrides: Partial<MentionEmailPipelineDeps> = {},
): ReturnType<typeof createMentionEmailPipeline> {
  const repos = createRepositories(db);
  return createMentionEmailPipeline({
    repos,
    logger: SILENT_LOGGER,
    transport,
    publicBaseUrl: PUBLIC_BASE_URL,
    fromAddress: FROM,
    windowMs: 60_000,
    retryDelaysMs: [],
    now: () => new Date('2026-06-22T13:00:00.000Z'),
    ...overrides,
  });
}

describe('createMentionEmailPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  dbTest('enqueueByMentionId batches + sends + marks email_sent_at', async ({ db }) => {
    seedUserAndNote(db, {
      aliceId: 'u-alice',
      bobId: 'u-bob',
      noteId: 'note-1',
      noteTitle: 'Spain',
    });
    const transportSend = vi.fn<EmailTransport['send']>().mockResolvedValue({ id: 'resend-msg-1' });
    const pipeline = buildPipeline(db, { send: transportSend });

    pipeline.enqueueByMentionId('mention-1');
    await vi.advanceTimersByTimeAsync(60_000);
    // Settle any pending microtasks from the batcher's awaited onSend.
    await vi.runAllTimersAsync();

    expect(transportSend).toHaveBeenCalledTimes(1);
    const payload = transportSend.mock.calls[0]![0];
    expect(payload.to).toBe('alice@example.com');
    expect(payload.from).toBe(FROM);
    expect(payload.subject).toContain('Bob');
    expect(payload.html).toContain('https://bartleby.example/n/note-1');

    const repos = createRepositories(db);
    const after = repos.mentions.findById('mention-1');
    expect(after?.email_sent_at).not.toBeNull();
  });

  dbTest('coalesces 3 mentions in 30s into one email', async ({ db }) => {
    const repos = createRepositories(db);
    seedUserAndNote(db, {
      aliceId: 'u-alice',
      bobId: 'u-bob',
      noteId: 'note-1',
      noteTitle: 'Spain',
    });
    // Insert two more mentions for the same recipient.
    repos.mentions.insert({
      id: 'mention-2',
      note_id: 'note-1',
      mentioned_user_id: 'u-alice',
      mentioning_user_id: 'u-bob',
      source: 'note:note-1',
      created_at: '2026-06-22T12:00:10.000Z',
    });
    repos.mentions.insert({
      id: 'mention-3',
      note_id: 'note-1',
      mentioned_user_id: 'u-alice',
      mentioning_user_id: 'u-bob',
      source: 'note:note-1',
      created_at: '2026-06-22T12:00:20.000Z',
    });
    const transportSend = vi.fn<EmailTransport['send']>().mockResolvedValue({ id: 'resend-msg-1' });
    const pipeline = buildPipeline(db, { send: transportSend });

    pipeline.enqueueByMentionId('mention-1');
    await vi.advanceTimersByTimeAsync(20_000);
    pipeline.enqueueByMentionId('mention-2');
    await vi.advanceTimersByTimeAsync(20_000);
    pipeline.enqueueByMentionId('mention-3');
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();

    expect(transportSend).toHaveBeenCalledTimes(1);
    const repos2 = createRepositories(db);
    expect(repos2.mentions.findById('mention-1')?.email_sent_at).not.toBeNull();
    expect(repos2.mentions.findById('mention-2')?.email_sent_at).not.toBeNull();
    expect(repos2.mentions.findById('mention-3')?.email_sent_at).not.toBeNull();
  });

  dbTest('skips mentions whose mentioned_user has no email row', async ({ db }) => {
    const repos = createRepositories(db);
    // Insert a note + bob, but no row for "alice" — manually craft an
    // orphan mention (FK would reject; use bob as mentioned + a missing
    // user as mentioner instead).
    repos.users.insert({
      id: 'u-bob',
      email: 'bob@example.com',
      display_name: 'Bob',
      color: '#bbb',
      created_at: '2026-06-22T11:00:00.000Z',
    });
    repos.notes.insert({
      id: 'note-1',
      title: 'Note',
      created_by: 'u-bob',
      created_at: '2026-06-22T11:00:00.000Z',
      updated_at: '2026-06-22T11:00:00.000Z',
      trashed_at: null,
      markdown_export: '',
    });
    // Pipeline call with an unknown id should warn + no-op.
    const transportSend = vi.fn<EmailTransport['send']>();
    const pipeline = buildPipeline(db, { send: transportSend });
    pipeline.enqueueByMentionId('no-such-id');
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();
    expect(transportSend).not.toHaveBeenCalled();
  });

  dbTest('flushAll sends pending batches synchronously', async ({ db }) => {
    seedUserAndNote(db, {
      aliceId: 'u-alice',
      bobId: 'u-bob',
      noteId: 'note-1',
      noteTitle: 'Spain',
    });
    const transportSend = vi.fn<EmailTransport['send']>().mockResolvedValue({ id: 'resend-msg' });
    const pipeline = buildPipeline(db, { send: transportSend });

    pipeline.enqueueByMentionId('mention-1');
    expect(transportSend).not.toHaveBeenCalled();
    await pipeline.flushAll();
    expect(transportSend).toHaveBeenCalledTimes(1);
  });

  dbTest('does not re-send for mentions whose email_sent_at is set', async ({ db }) => {
    const { mention: m } = seedUserAndNote(db, {
      aliceId: 'u-alice',
      bobId: 'u-bob',
      noteId: 'note-1',
      noteTitle: 'Spain',
    });
    const repos = createRepositories(db);
    repos.mentions.markEmailSent([m.id], '2026-06-22T12:30:00.000Z');
    const transportSend = vi.fn<EmailTransport['send']>();
    const pipeline = buildPipeline(db, { send: transportSend });
    pipeline.enqueueByMentionId(m.id);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();
    expect(transportSend).not.toHaveBeenCalled();
  });
});
