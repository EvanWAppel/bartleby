// Hocuspocus onStoreDocument hook (S-009). Runs after the SQLite
// extension's debounced WAL flush — Hocuspocus's own debounce keeps
// this from firing on every keystroke.
//
// For each store, given a YDoc + the matching `notes` metadata row
// (looked up by doc name = note uuid):
//   1. Serialize the YDoc to markdown.
//   2. Update notes.markdown_export — the FTS5 triggers from D-010
//      pick it up automatically.
//   3. Re-extract tags (frontmatter + inline #hashtag), replace
//      tags table atomically.
//   4. Re-extract [[backlinks]], resolve titles via
//      noteTitlesHistory, replace backlinks table atomically.
//
// Trashed notes are skipped — once soft-deleted, we don't want their
// edits showing up in search / tag indexes / backlinks even if a
// client keeps the WS open.

import type * as Y from 'yjs';
import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories/index.js';
import { extractMarkdown } from './markdown.js';
import { extractTags } from './tags.js';
import { extractBacklinks, resolveBacklinks, type TitleResolver } from './backlinks.js';

export interface DerivedStateHookDeps {
  repos: Repositories;
  logger: Logger;
  now?: () => Date;
}

export interface StoreDocumentPayload {
  document: Y.Doc;
  documentName: string;
}

export interface DerivedStateHook {
  onStoreDocument(payload: StoreDocumentPayload): Promise<void>;
}

export function createDerivedStateHook(deps: DerivedStateHookDeps): DerivedStateHook {
  const { repos, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const titleResolver: TitleResolver = (title) => {
    const matches = repos.noteTitlesHistory.resolveTitle(title);
    // Collapse by note_id — same logic as /notes/resolve. Ambiguous
    // titles resolve to nothing (we don't want to pick a winner).
    const uniqueIds = new Set(matches.map((m) => m.note_id));
    if (uniqueIds.size !== 1) {
      return null;
    }
    return uniqueIds.values().next().value!;
  };

  return {
    async onStoreDocument({ document, documentName }) {
      const row = repos.notes.findById(documentName);
      if (row === undefined) {
        logger.debug(
          { documentName },
          'derived-state: no notes row for doc, skipping (likely WS-only / legacy room)',
        );
        return;
      }
      if (row.trashed_at !== null) {
        logger.debug({ documentName }, 'derived-state: note is trashed, skipping');
        return;
      }

      const markdown = extractMarkdown(document);
      const updatedAt = now().toISOString();

      // markdown_export update → FTS triggers update notes_fts.
      repos.notes.updateMarkdownExport(documentName, markdown, updatedAt);

      // Tag + backlink tables: replace atomically.
      const tags = extractTags(markdown);
      repos.tags.replaceForNote(documentName, tags);

      const titles = extractBacklinks(markdown);
      const inputs = resolveBacklinks(titles, titleResolver);
      repos.backlinks.replaceForSource(documentName, inputs);

      logger.debug(
        {
          documentName,
          markdownChars: markdown.length,
          tagsCount: tags.length,
          backlinksCount: inputs.length,
        },
        'derived-state: updated',
      );
    },
  };
}
