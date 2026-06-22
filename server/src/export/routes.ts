// I-004 single-note export + I-005 export-all-as-zip + I-006 zip
// filename collision handling.
//
//   GET /notes/:id/export.md   — markdown body with frontmatter
//   GET /export/all.zip        — zip of all live notes
//
// Both endpoints read from `notes.markdown_export`, which the S-009
// derived-state hook keeps in sync with the live Yjs state. A note
// that's been imported but never opened may have an empty body until
// the first user-driven save populates markdown_export — acceptable
// for v1.
//
// Trashed notes are excluded from both endpoints. A user can still
// hit the /notes/:id/export.md path for a trashed note's id but
// they'll get a 404, same as every other read endpoint.

import { Hono } from 'hono';
import { zipSync, strToU8, type Zippable } from 'fflate';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import { NotFoundError } from '../http/errors.js';
import { assignZipFilenames, buildExportMarkdown, slugify } from './serializer.js';

export interface ExportAppDeps {
  repos: Repositories;
}

export function createExportApp(deps: ExportAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  // I-004: GET /notes/:id/export.md
  app.get('/notes/:id/export.md', (c) => {
    const id = c.req.param('id');
    const row = repos.notes.findById(id);
    if (row === undefined || row.trashed_at !== null) {
      throw new NotFoundError('note', id);
    }
    const tags = repos.tags.listForNote(id);
    const md = buildExportMarkdown({ row, tags });
    c.header('content-type', 'text/markdown; charset=utf-8');
    c.header('content-disposition', `attachment; filename="${slugify(row.title)}.md"`);
    return c.body(md);
  });

  // I-005: GET /export/all.zip — every live (non-trashed) note as
  // its own `.md` file inside a single zip. I-006 collision handling
  // appends an id-suffix when slugified titles repeat.
  app.get('/export/all.zip', (c) => {
    const notes = repos.notes.listLive();
    if (notes.length === 0) {
      // Returning an empty zip is fine. Build it the same way; fflate
      // produces a valid zero-entry archive.
      const empty = zipSync({});
      c.header('content-type', 'application/zip');
      c.header('content-disposition', 'attachment; filename="bartleby-notes.zip"');
      return c.body(empty);
    }
    const assignments = assignZipFilenames(notes);
    const entries: Zippable = {};
    for (const a of assignments) {
      const row = notes.find((n) => n.id === a.id);
      if (row === undefined) continue; // guard — should never happen.
      const tags = repos.tags.listForNote(a.id);
      entries[a.filename] = strToU8(buildExportMarkdown({ row, tags }));
    }
    const buf = zipSync(entries);
    c.header('content-type', 'application/zip');
    c.header('content-disposition', 'attachment; filename="bartleby-notes.zip"');
    return c.body(buf);
  });

  return app;
}
