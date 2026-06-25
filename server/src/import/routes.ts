// I-003 import endpoint: POST /notes/import (multipart).
//
// Accepts one or more `.md` files in a single multipart/form-data
// request. For each file:
//   1. Parse frontmatter + body (parseMarkdownDocument).
//   2. Pick a title — frontmatter title wins, otherwise filename
//      stripped of `.md`, otherwise "Untitled".
//   3. Insert a `notes` row + initial `note_titles_history` entry.
//   4. Seed the Yjs document with the parsed PM doc, via the same
//      accessor C-006 restore uses (replace + clear pattern).
//   5. Apply frontmatter tags (replaceForNote).
//
// Returns 201 with `{ notes: [{ id, title }] }` mirroring the shape
// callers expect from the existing POST /notes endpoint (just plural).
//
// Mounted under the same `/notes/*` auth gate as the other notes
// routes, so unauthenticated callers get a 401 before reaching the
// handler. Mounted BEFORE the dynamic `/notes/:id` route in http.ts so
// the static `/notes/import` path wins routing.

import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import { ValidationError } from '../http/errors.js';
import { ensureUserExists } from '../notes/ensure-user.js';
import type { YjsDocAccessor } from '../snapshots/yjs-access.js';
import { parseMarkdownDocument } from './parser.js';

export interface ImportAppDeps {
  repos: Repositories;
  yjs: YjsDocAccessor;
  /** Injectable clock so tests can pin timestamps. */
  now?: () => Date;
}

type ImportContext = Context<{ Variables: AuthVars }>;

function nowIso(deps: ImportAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

/**
 * Derive a note title from the upload's filename. Strips a `.md` /
 * `.markdown` extension; collapses repeated dots. Returns 'Untitled'
 * when the result is empty.
 */
function titleFromFilename(filename: string): string {
  // Strip any path components a multipart parser might pass through —
  // browsers usually send a bare filename, but be defensive.
  const bare = filename.split(/[\\/]/).pop() ?? filename;
  const withoutExt = bare.replace(/\.(md|markdown)$/i, '');
  const trimmed = withoutExt.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

interface ImportedFile {
  filename: string;
  content: string;
}

async function readMultipartFiles(c: ImportContext): Promise<ImportedFile[]> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new ValidationError('request must be multipart/form-data');
  }
  // Accept files under any field name — the canonical convention is
  // `files`, but we don't constrain so a JS DataTransfer that defaults
  // to `file` still works.
  const out: ImportedFile[] = [];
  for (const [, value] of formData.entries()) {
    if (typeof value === 'string') {
      // Not a file, skip — clients can layer metadata fields if they want.
      continue;
    }
    const file = value as File;
    const filename = file.name;
    if (!/\.(md|markdown)$/i.test(filename)) {
      throw new ValidationError(`only .md/.markdown files accepted (got: ${filename})`);
    }
    const content = await file.text();
    out.push({ filename, content });
  }
  if (out.length === 0) {
    throw new ValidationError('at least one .md file is required');
  }
  return out;
}

export function createImportApp(deps: ImportAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos, yjs } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  app.post('/notes/import', async (c) => {
    const files = await readMultipartFiles(c);
    const userId = ensureUserExists(repos.users, c.get('user'));

    const created: { id: string; title: string }[] = [];
    for (const f of files) {
      // parseMarkdownDocument throws on malformed YAML; let it propagate
      // — errorHandler maps it to a 500 unless wrapped. Wrap as
      // ValidationError so the client gets a useful 400.
      let parsed;
      try {
        parsed = parseMarkdownDocument(f.content);
      } catch (err) {
        throw new ValidationError(
          `failed to parse ${f.filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const title =
        parsed.frontmatter.title !== undefined && parsed.frontmatter.title.trim().length > 0
          ? parsed.frontmatter.title.trim()
          : titleFromFilename(f.filename);

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

      // Seed Yjs state. We build a throwaway Y.Doc, apply the parsed
      // ProseMirror tree into it via y-prosemirror, then hand the
      // encoded full state to the accessor.replace() which (for a
      // fresh Hocuspocus doc) just splats the content into the live
      // fragment.
      const seed = new Y.Doc();
      prosemirrorToYXmlFragment(parsed.pmDoc, seed.getXmlFragment('prosemirror'));
      const encoded = Y.encodeStateAsUpdate(seed);
      await yjs.replace(id, encoded);

      if (parsed.frontmatter.tags.length > 0) {
        repos.tags.replaceForNote(id, parsed.frontmatter.tags);
      }

      created.push({ id, title });
    }

    return c.json({ notes: created }, 201);
  });

  return app;
}
