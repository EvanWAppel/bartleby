// M-003 inbox endpoint + M-004 mark-as-read.
//
//   GET  /mentions               list mentions for the current user
//                                ?unread=true → unread only
//                                ?unread=false (or omitted) → all
//   POST /mentions/:id/read      sets read_at = now (idempotent)
//
// Auth gating is mounted by http.ts (requireSession). Mentions are
// scoped to the session user; nobody can read or mark someone else's
// inbox.

import { Hono } from 'hono';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import type { MentionRow } from '../db/repositories/index.js';
import { ForbiddenError, NotFoundError } from '../http/errors.js';

export interface MentionsAppDeps {
  repos: Repositories;
  /** Injectable clock so tests can pin read_at. */
  now?: () => Date;
}

function nowIso(deps: MentionsAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

interface MentionDto extends MentionRow {
  /** Convenience field — the title of the source note, looked up via
   * notes table. Saves the client an N+1 to render the inbox row. */
  note_title: string;
}

export function createMentionsApp(deps: MentionsAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  function withNoteTitle(row: MentionRow): MentionDto {
    const note = repos.notes.findById(row.note_id);
    return { ...row, note_title: note?.title ?? '(deleted note)' };
  }

  // GET /mentions — list for the session user.
  app.get('/mentions', (c) => {
    const user = c.get('user');
    const unreadOnly = c.req.query('unread') === 'true';
    const rows = repos.mentions.listForUser(user.id, { unread: unreadOnly });
    return c.json({ mentions: rows.map(withNoteTitle) });
  });

  // POST /mentions/:id/read — mark a single mention read. Refuses to
  // mark another user's mention (403) so a hostile client can't probe
  // somebody else's inbox by id.
  app.post('/mentions/:id/read', (c) => {
    const id = c.req.param('id');
    const row = repos.mentions.findById(id);
    if (row === undefined) {
      throw new NotFoundError('mention', id);
    }
    const user = c.get('user');
    if (row.mentioned_user_id !== user.id) {
      throw new ForbiddenError("cannot mark another user's mention");
    }
    repos.mentions.markRead(id, nowIso(deps));
    const updated = repos.mentions.findById(id);
    if (updated === undefined) {
      throw new NotFoundError('mention', id);
    }
    return c.json(withNoteTitle(updated));
  });

  return app;
}
