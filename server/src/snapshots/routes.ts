// C-003 / C-004 / C-006 snapshot REST endpoints.
//
//   POST   /notes/:id/snapshots                  create named snapshot (C-003)
//                                                body: { label: string }
//   GET    /notes/:id/snapshots                  paginated list (C-004)
//                                                query: ?limit=N&offset=N
//   POST   /notes/:id/snapshots/:snap_id/restore restore to snapshot (C-006)
//                                                writes a pre-restore auto
//                                                snapshot first, then applies
//                                                the snapshot's Yjs state.
//
// C-002's scheduler (auto-snapshots every ~5 min if changed) lives in
// scheduler.ts. C-005 retention (prune auto-snapshots beyond 50 per
// note, named exempt) is enforced inside this module's POST/restore
// paths AND inside the scheduler — wherever an auto-snapshot lands,
// we prune right after. The repo's pruneAutoSnapshots already filters
// `WHERE label IS NULL` so named snapshots stay safe.
//
// Yjs state is read/written via YjsDocAccessor — tests inject a stub;
// production wires Hocuspocus.openDirectConnection (see http.ts).

import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import { extractMarkdown } from '../derived/markdown.js';
import { NotFoundError, ValidationError } from '../http/errors.js';
import type { YjsDocAccessor } from './yjs-access.js';

type SnapshotsContext = Context<{ Variables: AuthVars }>;

export interface SnapshotsAppDeps {
  repos: Repositories;
  yjs: YjsDocAccessor;
  /** Injectable clock for created_at timestamps; tests pin this. */
  now?: () => Date;
  /** C-005: how many auto-snapshots to keep per note. Default 50. */
  autoSnapshotRetention?: number;
}

async function parseJsonBody(c: SnapshotsContext): Promise<unknown> {
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

function nowIso(deps: SnapshotsAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

interface SnapshotDto {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
  /** Base64-encoded yjs_state. Only included on the single-snapshot
   * detail/preview path; the list endpoint omits it to keep responses
   * bounded. */
  yjs_state_base64?: string;
  /** Markdown rendering of the snapshot's content, served alongside
   * yjs_state_base64 so the preview pane doesn't have to pull in Yjs
   * to render the snapshot. */
  markdown_preview?: string;
}

function decodeSnapshotToMarkdown(yjsState: Buffer): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(yjsState));
  return extractMarkdown(doc);
}

function toListDto(row: {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
}): SnapshotDto {
  return {
    id: row.id,
    note_id: row.note_id,
    label: row.label,
    created_at: row.created_at,
  };
}

function toDetailDto(row: {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
  yjs_state: Buffer;
}): SnapshotDto {
  let markdown = '';
  try {
    markdown = decodeSnapshotToMarkdown(row.yjs_state);
  } catch {
    // A snapshot with malformed bytes (shouldn't happen in production
    // but the test fixture seeds garbage for retention tests) renders
    // as an empty preview rather than 500ing the whole response.
    markdown = '';
  }
  return {
    ...toListDto(row),
    yjs_state_base64: row.yjs_state.toString('base64'),
    markdown_preview: markdown,
  };
}

export function createSnapshotsApp(deps: SnapshotsAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos, yjs } = deps;
  const retention = deps.autoSnapshotRetention ?? 50;
  const app = new Hono<{ Variables: AuthVars }>();

  // C-003: create a named snapshot of the current Yjs state.
  app.post('/notes/:id/snapshots', async (c) => {
    const noteId = c.req.param('id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const body = (await parseJsonBody(c)) as Record<string, unknown>;
    const label = asString(body['label'] ?? '', 'label');
    if (label.trim().length === 0) {
      throw new ValidationError('label must not be empty');
    }
    const encoded = await yjs.read(noteId);
    const row = repos.snapshots.insert({
      id: randomUUID(),
      note_id: noteId,
      yjs_state: Buffer.from(encoded),
      created_at: nowIso(deps),
      label,
    });
    return c.json(toListDto(row), 201);
  });

  // C-004: paginated list, newest first. The repo already orders by
  // created_at DESC; we forward limit/offset query params.
  app.get('/notes/:id/snapshots', (c) => {
    const noteId = c.req.param('id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const limitRaw = c.req.query('limit');
    const offsetRaw = c.req.query('offset');
    const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
    const offset = offsetRaw === undefined ? undefined : Number.parseInt(offsetRaw, 10);
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
      throw new ValidationError('limit must be a non-negative integer');
    }
    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    const rows = repos.snapshots.listByNote(noteId, { limit, offset });
    return c.json({ snapshots: rows.map(toListDto) });
  });

  // GET single snapshot (with yjs_state_base64) so the preview pane
  // can decode + render markdown without a second hop.
  app.get('/notes/:id/snapshots/:snap_id', (c) => {
    const noteId = c.req.param('id');
    const snapId = c.req.param('snap_id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const row = repos.snapshots.findById(snapId);
    if (row === undefined || row.note_id !== noteId) {
      throw new NotFoundError('snapshot', snapId);
    }
    return c.json(toDetailDto(row));
  });

  // C-006: restore. Take a pre-restore auto-snapshot of the current
  // state, then apply the target snapshot's bytes to the live doc.
  // The pre-restore snapshot makes "undo a restore" possible without
  // a separate UI affordance — the user can just restore again to
  // that pre-restore row in the list.
  app.post('/notes/:id/snapshots/:snap_id/restore', async (c) => {
    const noteId = c.req.param('id');
    const snapId = c.req.param('snap_id');
    const note = repos.notes.findById(noteId);
    if (note === undefined || note.trashed_at !== null) {
      throw new NotFoundError('note', noteId);
    }
    const target = repos.snapshots.findById(snapId);
    if (target === undefined || target.note_id !== noteId) {
      throw new NotFoundError('snapshot', snapId);
    }
    // Step 1: pre-restore auto-snapshot. Always unlabeled (it's
    // synthetic), so retention can prune it down the road.
    const preEncoded = await yjs.read(noteId);
    repos.snapshots.insert({
      id: randomUUID(),
      note_id: noteId,
      yjs_state: Buffer.from(preEncoded),
      created_at: nowIso(deps),
      label: null,
    });
    repos.snapshots.pruneAutoSnapshots(noteId, retention);
    // Step 2: apply the target snapshot's bytes to the live doc.
    await yjs.replace(noteId, new Uint8Array(target.yjs_state));
    return c.json({ ok: true, restored_from: target.id });
  });

  return app;
}
