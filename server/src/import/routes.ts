// I-003 POST /notes/import — multipart upload of one or more `.md`
// files. Each file becomes a new note:
//   1. Parse frontmatter (title, tags) + body.
//   2. Insert a notes row using the frontmatter title (or the
//      filename, or "Untitled" — whichever lands first non-empty).
//   3. Build the Yjs initial state from the parsed PM doc and write
//      it via YjsDocAccessor.replace so the Hocuspocus storage carries
//      the body before any client connects.
//   4. Apply frontmatter tags via the tags repo.
//
// The endpoint accepts a multipart payload with one or more `files`
// parts. Returns `{ notes: [{ id, title }] }` so the client can
// optimistically render new sidebar rows before the next NotesStore
// poll.
//
// We DON'T trigger the S-009 derived-state hook directly — it'll
// fire on the first Yjs save (when a client connects + edits), which
// will fill in markdown_export / FTS / mention extraction.

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type { AuthVars } from '../auth/index.js';
import type { Repositories } from '../db/repositories/index.js';
import { ValidationError } from '../http/errors.js';
import { ensureUserExists } from '../notes/ensure-user.js';
import type { YjsDocAccessor } from '../snapshots/yjs-access.js';
import { parseMarkdownToProseMirror } from './parser.js';

export interface ImportAppDeps {
  repos: Repositories;
  yjs: YjsDocAccessor;
  /** Injectable clock; tests pin this. */
  now?: () => Date;
}

function nowIso(deps: ImportAppDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

interface ImportedNoteDto {
  id: string;
  title: string;
}

function titleFromFilename(name: string | undefined): string {
  if (name === undefined || name.length === 0) return 'Untitled';
  // Strip directory components a browser may include + the .md
  // extension. We tolerate uppercase variants too.
  const base = name.replace(/^.*[\\/]/, '');
  return base.replace(/\.(md|markdown)$/i, '') || 'Untitled';
}

export function createImportApp(deps: ImportAppDeps): Hono<{ Variables: AuthVars }> {
  const { repos, yjs } = deps;
  const app = new Hono<{ Variables: AuthVars }>();

  // POST /notes/import — multipart, one or more `files`.
  app.post('/notes/import', async (c) => {
    const form = await c.req.formData();
    const files = form.getAll('files');
    if (files.length === 0) {
      throw new ValidationError('at least one `files` part is required');
    }
    const user = c.get('user');
    const userId = ensureUserExists(repos.users, user);
    const createdAt = nowIso(deps);

    const imported: ImportedNoteDto[] = [];
    for (const entry of files) {
      if (typeof entry === 'string') {
        // multipart form-data text fields land here; we only accept files.
        continue;
      }
      // Web's File / Node's File-shim both expose `.text()` and `.name`.
      const markdown = await entry.text();
      const filename = 'name' in entry && typeof entry.name === 'string' ? entry.name : undefined;
      const { doc, title: fmTitle, tags } = parseMarkdownToProseMirror(markdown);

      const title =
        (fmTitle !== null && fmTitle.length > 0 ? fmTitle : titleFromFilename(filename)).trim() ||
        'Untitled';

      const id = randomUUID();
      repos.notes.insert({
        id,
        title,
        created_by: userId,
        created_at: createdAt,
        updated_at: createdAt,
        trashed_at: null,
        markdown_export: '',
      });
      repos.noteTitlesHistory.append(id, title, createdAt);

      // Build the initial Yjs state from the parsed PM doc and write
      // it via the same yjs-access path C-006 restore uses. The new
      // note's room name is the note id.
      const ydoc = new Y.Doc();
      prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment('prosemirror'));
      const encoded = Y.encodeStateAsUpdate(ydoc);
      await yjs.replace(id, encoded);

      // Apply frontmatter tags AFTER yjs.replace. The replace triggers
      // Hocuspocus's onStoreDocument → S-009 hook, which re-extracts
      // tags from the markdown body and overwrites whatever's in the
      // tags table. Writing here last means our frontmatter tags
      // survive into the response and the next NotesStore poll. (The
      // next user-driven save will still rerun S-009 and wipe these
      // if the body has no inline #tags — for v1 that's acceptable
      // since the user can re-add tags inline or via the tag editor.)
      if (tags.length > 0) {
        repos.tags.replaceForNote(id, tags);
      }

      imported.push({ id, title });
    }

    if (imported.length === 0) {
      throw new ValidationError('no valid file parts in upload');
    }
    return c.json({ notes: imported }, 201);
  });

  return app;
}
