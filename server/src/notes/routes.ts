// Notes REST API (S-001..S-006). Mounts under the same hono root as the
// auth routes and inherits the requireSession middleware applied above.
//
// Each handler:
//   1. Reads `c.get('user')` (set by requireSession in production, by
//      a stub in tests).
//   2. Bridges the session user into D's users table via
//      ensureUserExists so created_by FK lands.
//   3. Calls the appropriate repository methods.
//
// Yjs document state lives in Hocuspocus's `documents` table (separate
// from D's `notes` table). POST /notes just inserts the metadata row;
// the empty Yjs doc materializes when a client first connects over WS.

import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import type { NoteRow } from '../db/repositories/index.js';
import { NotFoundError, ValidationError } from '../http/errors.js';
import { ensureUserExists } from './ensure-user.js';

type NotesContext = Context<{ Variables: AuthVars }>;

export interface NotesAppDeps {
  repos: Repositories;
  /** Injectable clock so tests can pin timestamps. */
  now?: () => Date;
}

interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  updated_at: string;
  created_at: string;
}

function toSummary(row: NoteRow, tags: string[]): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    tags,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

async function parseJsonBody(c: NotesContext): Promise<unknown> {
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

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  return value.map((v, i) => asString(v, `${field}[${i}]`));
}

function nowIso(deps: NotesAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

export function createNotesApp(deps: NotesAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  // POST /notes — create empty note. S-001.
  app.post('/notes', async (c) => {
    const body = (await parseJsonBody(c)) as Record<string, unknown>;
    const rawTitle = body['title'];
    let title: string;
    if (rawTitle === undefined || rawTitle === '') {
      title = 'Untitled';
    } else {
      title = asString(rawTitle, 'title');
      if (title.trim().length === 0) {
        title = 'Untitled';
      }
    }

    const userId = ensureUserExists(repos.users, c.get('user'));
    const id = randomUUID();
    const nowAt = nowIso(deps);
    repos.notes.insert({
      id,
      title,
      created_by: userId,
      created_at: nowAt,
      updated_at: nowAt,
      trashed_at: null,
      markdown_export: '',
    });
    repos.noteTitlesHistory.append(id, title, nowAt);

    return c.json({ id, title }, 201);
  });

  // GET /notes — list live notes; ?tag= / ?q= filters. S-002.
  app.get('/notes', (c) => {
    const tag = c.req.query('tag');
    const q = c.req.query('q');

    let rows: NoteRow[];
    if (tag !== undefined && tag.length > 0) {
      const ids = new Set(repos.tags.listNotesByTag(tag));
      rows = repos.notes.listLive().filter((n) => ids.has(n.id));
    } else if (q !== undefined && q.length > 0) {
      // search already filters out trashed notes; we just need to load
      // the full row to build the summary.
      rows = [];
      for (const hit of repos.search.searchNotes(q)) {
        const row = repos.notes.findById(hit.id);
        if (row !== undefined) {
          rows.push(row);
        }
      }
    } else {
      rows = repos.notes.listLive();
    }

    // listLive already returns newest-first; preserve that for tag/q paths
    // by re-sorting on updated_at desc.
    rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));

    const notes = rows.map((row) => toSummary(row, repos.tags.listForNote(row.id)));
    return c.json({ notes });
  });

  // GET /notes/trash — list trashed. S-003.
  app.get('/notes/trash', (c) => {
    const rows = repos.notes.listTrashed();
    const notes = rows.map((row) => toSummary(row, repos.tags.listForNote(row.id)));
    return c.json({ notes });
  });

  // GET /notes/resolve?title=... — title -> uuid (alias-aware). S-008.
  // 200 with id when exactly one note matches (current or historical);
  // 300 with candidates when two or more notes have ever used the title;
  // 404 if never used; 400 if ?title is missing.
  // Registered BEFORE /notes/:id so the static path wins.
  app.get('/notes/resolve', (c) => {
    const title = c.req.query('title');
    if (title === undefined || title.length === 0) {
      throw new ValidationError('title query param is required');
    }
    const matches = repos.noteTitlesHistory.resolveTitle(title);
    // Collapse duplicates: one note may appear multiple times if its title
    // toggled back and forth. Prefer the current row when both exist.
    const byNote = new Map<string, { id: string; is_current: boolean }>();
    for (const m of matches) {
      const prev = byNote.get(m.note_id);
      if (prev === undefined || (!prev.is_current && m.is_current)) {
        byNote.set(m.note_id, { id: m.note_id, is_current: m.is_current });
      }
    }
    const unique = [...byNote.values()];
    if (unique.length === 0) {
      throw new NotFoundError('title', title);
    }
    if (unique.length === 1) {
      return c.json({ id: unique[0]!.id });
    }
    return c.json({ candidates: unique.map((u) => ({ id: u.id })) }, 300);
  });

  // GET /notes/:id/backlinks — inbound links with source titles. S-007.
  app.get('/notes/:id/backlinks', (c) => {
    const id = c.req.param('id');
    if (repos.notes.findById(id) === undefined) {
      throw new NotFoundError('note', id);
    }
    const rows = repos.backlinks.listInbound(id);
    const backlinks: { source_id: string; source_title: string; link_text: string }[] = [];
    for (const row of rows) {
      const source = repos.notes.findById(row.source_note_id);
      // Skip phantom sources (deleted / trashed) — we don't want clients
      // surfacing them in an inbound-links list.
      if (source === undefined || source.trashed_at !== null) {
        continue;
      }
      backlinks.push({
        source_id: source.id,
        source_title: source.title,
        link_text: row.link_text,
      });
    }
    return c.json({ backlinks });
  });

  // PATCH /notes/:id — rename + retag. S-004.
  app.patch('/notes/:id', async (c) => {
    const id = c.req.param('id');
    const existing = repos.notes.findById(id);
    if (existing === undefined) {
      throw new NotFoundError('note', id);
    }
    const body = (await parseJsonBody(c)) as Record<string, unknown>;

    const updatedAt = nowIso(deps);
    let changed = false;

    if (body['title'] !== undefined) {
      const title = asString(body['title'], 'title');
      if (title !== existing.title) {
        repos.notes.updateTitle(id, title, updatedAt);
        repos.noteTitlesHistory.append(id, title, updatedAt);
        changed = true;
      }
    }
    if (body['tags'] !== undefined) {
      const tags = asStringArray(body['tags'], 'tags');
      repos.tags.replaceForNote(id, tags);
      changed = true;
    }

    const refreshed = changed ? repos.notes.findById(id) : existing;
    const tags = repos.tags.listForNote(id);
    return c.json(toSummary(refreshed!, tags));
  });

  // DELETE /notes/:id — soft delete. S-005.
  app.delete('/notes/:id', (c) => {
    const id = c.req.param('id');
    const existing = repos.notes.findById(id);
    if (existing === undefined) {
      throw new NotFoundError('note', id);
    }
    repos.notes.softDelete(id, nowIso(deps));
    return c.body(null, 204);
  });

  // POST /notes/:id/restore — clear trashed_at. S-006.
  app.post('/notes/:id/restore', (c) => {
    const id = c.req.param('id');
    const existing = repos.notes.findById(id);
    if (existing === undefined) {
      throw new NotFoundError('note', id);
    }
    repos.notes.restore(id);
    return c.body(null, 204);
  });

  return app;
}
