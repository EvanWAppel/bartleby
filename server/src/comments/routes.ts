// C-007: Comments REST CRUD.
//
//   POST   /notes/:id/comments        create top-level comment
//   GET    /notes/:id/comments        list (open by default; ?include=resolved
//                                       returns the full set including
//                                       resolved comments)
//   POST   /comments/:id/replies      reply to a comment
//   PATCH  /comments/:id/resolve      set resolved_at (no body)
//   PATCH  /comments/:id/reopen       clear resolved_at (no body)
//   DELETE /comments/:id              delete the row
//
// The author is taken from the session user. created_at is taken from
// the injected clock so tests can pin timestamps. Author info is NOT
// joined into the response — the client gets author_id and resolves to
// display info via GET /users (W-013). That keeps the row shape narrow
// and avoids a per-row join.
//
// Anchor is stored as opaque text (PRD §6.4: serialized Yjs
// RelativePosition pair). C-008 will run orphan-detection on top; the
// raw bytes don't need to be parsed server-side here.

import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import type { CommentRow } from '../db/repositories/index.js';
import { extractMentionEmails } from '../derived/mentions.js';
import { NotFoundError, ValidationError } from '../http/errors.js';
import type { YjsDocAccessor } from '../snapshots/yjs-access.js';
import { resolveAnchorToText } from './anchor.js';

type CommentsContext = Context<{ Variables: AuthVars }>;

export interface CommentsAppDeps {
  repos: Repositories;
  /** Injectable clock so tests can pin timestamps. */
  now?: () => Date;
  /**
   * C-009: when present, the create handler resolves the anchor against
   * the live YDoc to snapshot `original_quote`. When absent (e.g. unit
   * tests that don't exercise the Yjs path) the handler falls back to
   * the client-supplied value.
   */
  yjs?: YjsDocAccessor;
  /**
   * M-005: invoked once per freshly-inserted mention row id. Wired to
   * the email pipeline's `enqueueByMentionId` in production. Strictly
   * fire-and-forget — `extractCommentMentions` MUST NOT block the
   * comment-create response on the email path.
   */
  onMentionInserted?: (mentionId: string) => void;
}

async function parseJsonBody(c: CommentsContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('request body must be valid JSON');
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function asRequiredBody(value: unknown): string {
  const s = asString(value, 'body');
  if (s.trim().length === 0) {
    throw new ValidationError('body must not be empty');
  }
  return s;
}

function nowIso(deps: CommentsAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

function toDto(row: CommentRow): CommentRow {
  // Pass the row through verbatim — its shape already matches the wire
  // contract (snake_case fields), and the CommentRow type is exported
  // from the repositories barrel so the web client can mirror it.
  return row;
}

/**
 * M-002 helper. After a comment row lands, scan its body for `@email`
 * mentions, resolve each to a user, and insert a mentions row per
 * net-new (user, comment) pair. Source is `comment:<comment_id>` so
 * the same user mentioned in a different comment stays a separate
 * inbox entry. Self-mentions (commenter mentioning themselves) are
 * silently dropped.
 */
function extractCommentMentions(deps: CommentsAppDeps, comment: CommentRow): void {
  const { repos } = deps;
  const source = `comment:${comment.id}`;
  const emails = extractMentionEmails(comment.body);
  if (emails.length === 0) return;
  const at = comment.created_at;
  for (const email of emails) {
    const user = repos.users.findByEmail(email);
    if (user === undefined) continue;
    if (user.id === comment.author_id) continue;
    const mentionId = randomUUID();
    repos.mentions.insert({
      id: mentionId,
      note_id: comment.note_id,
      mentioned_user_id: user.id,
      mentioning_user_id: comment.author_id,
      source,
      created_at: at,
    });
    // M-005: queue an email send. Fire-and-forget so the comment POST
    // response never waits on Resend.
    if (deps.onMentionInserted !== undefined) {
      try {
        deps.onMentionInserted(mentionId);
      } catch {
        // The pipeline catches its own errors; this is belt-and-
        // suspenders for a synchronous throw. Don't let it bubble out
        // of the route handler.
      }
    }
  }
}

export function createCommentsApp(deps: CommentsAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  // POST /notes/:id/comments — create top-level comment.
  app.post('/notes/:id/comments', async (c) => {
    const noteId = c.req.param('id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const body = (await parseJsonBody(c)) as Record<string, unknown>;
    const anchor = asString(body['anchor'] ?? '', 'anchor');
    const clientQuote = asString(body['original_quote'] ?? '', 'original_quote');
    const text = asRequiredBody(body['body']);
    const user = c.get('user');

    // C-009: the source-of-truth for `original_quote` is the text
    // currently between the anchor endpoints in the live YDoc. We
    // recompute server-side so the snapshot can't drift from the
    // doc (e.g. if the client raced an edit between selecting and
    // posting). Fall back to the client-supplied value when:
    //   - no Yjs accessor is wired (unit tests)
    //   - the anchor is empty/unparseable
    //   - the doc has no PM content yet
    //   - the anchor doesn't resolve at create time (rare; treat as
    //     "we couldn't snapshot" and store the client's best guess)
    let originalQuote = clientQuote;
    if (deps.yjs !== undefined && anchor !== '') {
      try {
        const encoded = await deps.yjs.read(noteId);
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, encoded);
        const resolved = resolveAnchorToText(ydoc, anchor);
        if (resolved !== null) {
          originalQuote = resolved;
        }
      } catch {
        // Reading the doc shouldn't sink the create. Keep the
        // client-supplied quote and move on.
      }
    }

    const row = repos.comments.insert({
      id: randomUUID(),
      note_id: noteId,
      author_id: user.id,
      parent_comment_id: null,
      anchor,
      original_quote: originalQuote,
      body: text,
      created_at: nowIso(deps),
    });
    extractCommentMentions(deps, row);
    return c.json(toDto(row), 201);
  });

  // GET /notes/:id/comments — list. ?include=resolved to also see closed threads.
  app.get('/notes/:id/comments', (c) => {
    const noteId = c.req.param('id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const includeResolved = c.req.query('include') === 'resolved';
    const rows = repos.comments.listByNote(noteId, { includeResolved });
    return c.json({ comments: rows.map(toDto) });
  });

  // POST /comments/:id/replies — reply to a comment.
  app.post('/comments/:id/replies', async (c) => {
    const parentId = c.req.param('id');
    const parent = repos.comments.findById(parentId);
    if (parent === undefined) {
      throw new NotFoundError('comment', parentId);
    }
    const body = (await parseJsonBody(c)) as Record<string, unknown>;
    const text = asRequiredBody(body['body']);
    const user = c.get('user');
    const row = repos.comments.insert({
      id: randomUUID(),
      note_id: parent.note_id,
      author_id: user.id,
      parent_comment_id: parent.id,
      // Replies inherit the parent's anchor so the in-body marker still
      // points at the same selection range; original_quote is empty by
      // convention (the parent already snapshotted it).
      anchor: parent.anchor,
      original_quote: '',
      body: text,
      created_at: nowIso(deps),
    });
    extractCommentMentions(deps, row);
    return c.json(toDto(row), 201);
  });

  // PATCH /comments/:id/resolve — set resolved_at.
  app.patch('/comments/:id/resolve', (c) => {
    const id = c.req.param('id');
    if (repos.comments.findById(id) === undefined) {
      throw new NotFoundError('comment', id);
    }
    repos.comments.resolve(id, nowIso(deps));
    const row = repos.comments.findById(id);
    if (row === undefined) {
      throw new NotFoundError('comment', id);
    }
    return c.json(toDto(row));
  });

  // PATCH /comments/:id/reopen — clear resolved_at.
  app.patch('/comments/:id/reopen', (c) => {
    const id = c.req.param('id');
    if (repos.comments.findById(id) === undefined) {
      throw new NotFoundError('comment', id);
    }
    repos.comments.reopen(id);
    const row = repos.comments.findById(id);
    if (row === undefined) {
      throw new NotFoundError('comment', id);
    }
    return c.json(toDto(row));
  });

  // DELETE /comments/:id — delete the row.
  app.delete('/comments/:id', (c) => {
    const id = c.req.param('id');
    if (repos.comments.findById(id) === undefined) {
      throw new NotFoundError('comment', id);
    }
    repos.comments.delete(id);
    return c.body(null, 204);
  });

  return app;
}
