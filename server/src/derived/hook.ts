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

import { randomUUID } from 'node:crypto';
import type * as Y from 'yjs';
import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories/index.js';
import { extractMarkdown } from './markdown.js';
import { extractTags } from './tags.js';
import { extractBacklinks, resolveBacklinks, type TitleResolver } from './backlinks.js';
import { extractMentionEmails } from './mentions.js';
import { isAnchorOrphaned } from '../comments/anchor.js';

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

      // M-001: mention extraction. Scan the markdown for `@email`
      // mentions, resolve each to a user_id via the users table, and
      // insert a row per net-new (user, note) pair. Re-extraction is
      // idempotent — existing rows for this note's body source stay
      // put, so a save that doesn't change the mention set adds
      // nothing. We deliberately do NOT delete rows when a mention is
      // removed: the inbox is a record of what was said, not a
      // mirror of the current doc state.
      const bodySource = `note:${documentName}`;
      const existing = repos.mentions.listForNote(documentName, { source: bodySource });
      const existingUserIds = new Set(existing.map((r) => r.mentioned_user_id));
      const mentionEmails = extractMentionEmails(markdown);
      let mentionsInserted = 0;
      for (const email of mentionEmails) {
        const user = repos.users.findByEmail(email);
        if (user === undefined) continue;
        // The note's `created_by` is our best guess at who added the
        // mention. We can't recover the actual mentioner from a Yjs
        // save (no per-edit attribution); v1 attributes to the note
        // owner and the email-batching M-005 work can reuse the same
        // field later.
        const mentioningId = row.created_by;
        if (user.id === mentioningId) continue; // don't notify self
        if (existingUserIds.has(user.id)) continue;
        repos.mentions.insert({
          id: randomUUID(),
          note_id: documentName,
          mentioned_user_id: user.id,
          mentioning_user_id: mentioningId,
          source: bodySource,
          created_at: updatedAt,
        });
        existingUserIds.add(user.id);
        mentionsInserted += 1;
      }

      // C-008: comment orphan recompute. Walk every comment on this
      // note (resolved or not) and refresh `is_orphaned` against the
      // current YDoc. Resolved threads still get a refresh so a future
      // snapshot restore that brings the anchored text back can un-
      // orphan them automatically. We only write when the flag changes
      // so we don't churn the table on every save.
      let orphansUpdated = 0;
      for (const comment of repos.comments.listAllByNote(documentName)) {
        const nextOrphan = isAnchorOrphaned(document, comment.anchor);
        if (nextOrphan !== comment.is_orphaned) {
          repos.comments.setOrphaned(comment.id, nextOrphan);
          orphansUpdated += 1;
        }
      }

      logger.debug(
        {
          documentName,
          markdownChars: markdown.length,
          tagsCount: tags.length,
          backlinksCount: inputs.length,
          mentionsInserted,
          orphansUpdated,
        },
        'derived-state: updated',
      );
    },
  };
}
