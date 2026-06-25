// Glue: takes a freshly-inserted mention row id, hydrates it into a
// `MentionBatchItem` (user lookups, note title, snippet) and hands it
// to the batcher. The batcher's `onSend` renders the template and
// dispatches to the email sender. The sender's success path marks
// `email_sent_at` so a future scan-and-resend job (out of scope) can
// find dead-lettered mentions.
//
// Wiring lives in `index.ts` (production) and `pipeline.test.ts`
// (integration tests). The hook in `derived/hook.ts` and the comments
// route in `comments/routes.ts` both call `enqueueByMentionId(id)` —
// fire-and-forget, never awaited from the request path.

import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories/index.js';
import {
  createMentionBatcher,
  type MentionBatch,
  type MentionBatchItem,
  type MentionBatcher,
} from './batcher.js';
import { createEmailSender, type EmailSender, type EmailTransport } from './email-sender.js';
import { renderMentionBatch, type MentionEmailSource } from './email-template.js';

export interface MentionEmailPipelineDeps {
  repos: Repositories;
  logger: Logger;
  transport: EmailTransport;
  publicBaseUrl: string;
  /** "From" address Resend uses. e.g. mentions@bartleby.example. */
  fromAddress: string;
  /** Override the 60s sliding window (tests). */
  windowMs?: number;
  /** Override the sender's retry delays (tests). */
  retryDelaysMs?: number[];
  /** Injectable clock for tests — used to stamp email_sent_at. */
  now?: () => Date;
}

export interface MentionEmailPipeline {
  /** Look up the mention by id, hydrate, enqueue. Logs + drops on
   * lookup failure so a malformed call can't crash the caller. */
  enqueueByMentionId(mentionId: string): void;
  /** Fire every pending batch immediately. Called from SIGTERM/SIGINT. */
  flushAll(): Promise<void>;
}

const SOURCE_PREFIX_COMMENT = 'comment:';

function classifySource(source: string): MentionEmailSource {
  if (source.startsWith(SOURCE_PREFIX_COMMENT)) return 'comment';
  return 'note';
}

/**
 * Pull a short, single-line snippet around the first `@<email>` mention
 * inside the markdown body. Trims to ~240 chars and replaces newlines
 * with spaces so the email blockquote doesn't sprawl. If the mention
 * can't be located (e.g. the markdown was edited after the row was
 * created), returns a generic fallback so the email still renders.
 */
export function extractSnippetForRecipient(
  markdown: string,
  recipientEmail: string,
  fallback = '(see note for context)',
): string {
  if (markdown.length === 0) return fallback;
  const needle = `@${recipientEmail}`;
  const lower = markdown.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx === -1) {
    // Mention not in the current markdown body — return the first
    // non-empty line as a best-effort context.
    const firstLine = markdown.split('\n').find((l) => l.trim().length > 0);
    return firstLine !== undefined ? truncate(firstLine, 240) : fallback;
  }
  const radius = 120;
  const start = Math.max(0, idx - radius);
  const end = Math.min(markdown.length, idx + needle.length + radius);
  const window = markdown.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < markdown.length ? ' …' : '';
  return truncate(prefix + window + suffix, 280);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export function createMentionEmailPipeline(deps: MentionEmailPipelineDeps): MentionEmailPipeline {
  const { repos, logger, transport, publicBaseUrl, fromAddress } = deps;
  const now = deps.now ?? (() => new Date());

  const sender: EmailSender = createEmailSender({
    transport,
    logger,
    retryDelaysMs: deps.retryDelaysMs,
  });

  async function onSend(batch: MentionBatch): Promise<void> {
    if (batch.length === 0) return;
    const first = batch[0]!;
    const rendered = renderMentionBatch({
      recipientName: first.recipientName,
      recipientEmail: first.recipientEmail,
      publicBaseUrl,
      items: batch.map((b) => ({
        mentionerName: b.mentionerName,
        mentionerEmail: b.mentionerEmail,
        noteId: b.noteId,
        noteTitle: b.noteTitle,
        source: b.source,
        snippet: b.snippet,
        mentionedAt: b.mentionedAt,
      })),
    });
    try {
      await sender.send({
        to: first.recipientEmail,
        from: fromAddress,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (err) {
      // The sender already logged; we deliberately leave email_sent_at
      // NULL so a future scan-and-resend can pick the dead-letter up.
      logger.error(
        {
          mentionIds: batch.map((b) => b.mentionId),
          recipient: first.recipientEmail,
          error: err instanceof Error ? err.message : String(err),
        },
        'mention-email-pipeline: send failed — leaving email_sent_at NULL',
      );
      return;
    }
    // Success — mark every mention in the batch.
    repos.mentions.markEmailSent(
      batch.map((b) => b.mentionId),
      now().toISOString(),
    );
    logger.info(
      {
        recipient: first.recipientEmail,
        mentionIds: batch.map((b) => b.mentionId),
        count: batch.length,
      },
      'mention-email-pipeline: batch sent',
    );
  }

  const batcher: MentionBatcher = createMentionBatcher({
    onSend,
    logger,
    windowMs: deps.windowMs,
  });

  function enqueueByMentionId(mentionId: string): void {
    const row = repos.mentions.findById(mentionId);
    if (row === undefined) {
      logger.warn({ mentionId }, 'mention-email-pipeline: unknown mention id, skipping');
      return;
    }
    if (row.email_sent_at !== null) {
      // Idempotent: don't re-enqueue something already sent. Protects
      // against the hook firing twice for the same row (e.g. retry of
      // an upstream save).
      logger.debug({ mentionId }, 'mention-email-pipeline: already sent, skipping');
      return;
    }
    const recipient = repos.users.findById(row.mentioned_user_id);
    if (recipient === undefined) {
      logger.warn(
        { mentionId, mentionedUserId: row.mentioned_user_id },
        'mention-email-pipeline: recipient user row missing, skipping',
      );
      return;
    }
    const mentioner = repos.users.findById(row.mentioning_user_id);
    if (mentioner === undefined) {
      logger.warn(
        { mentionId, mentioningUserId: row.mentioning_user_id },
        'mention-email-pipeline: mentioner user row missing, skipping',
      );
      return;
    }
    const note = repos.notes.findById(row.note_id);
    if (note === undefined) {
      logger.warn(
        { mentionId, noteId: row.note_id },
        'mention-email-pipeline: note missing, skipping',
      );
      return;
    }

    const item: MentionBatchItem = {
      mentionId: row.id,
      mentionedUserId: row.mentioned_user_id,
      mentionerName: mentioner.display_name,
      mentionerEmail: mentioner.email,
      recipientName: recipient.display_name,
      recipientEmail: recipient.email,
      noteId: note.id,
      noteTitle: note.title,
      source: classifySource(row.source),
      snippet: extractSnippetForRecipient(note.markdown_export, recipient.email),
      mentionedAt: row.created_at,
    };
    batcher.enqueue(item);
  }

  return {
    enqueueByMentionId,
    flushAll() {
      return batcher.flushAll();
    },
  };
}
