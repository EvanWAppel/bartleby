// Yjs YDoc -> markdown string. Used by the Hocuspocus onStoreDocument
// hook (S-009) to keep `notes.markdown_export` in sync with the live
// CRDT state so derived state (FTS5, tag extraction, backlink
// extraction) can run on plain text.
//
// The basic ProseMirror schema matches what the web editor mounts
// (src/lib/Editor.svelte). When we add task lists / code blocks the
// schema needs to grow to match.

import * as Y from 'yjs';
import { schema } from 'prosemirror-schema-basic';
import { defaultMarkdownSerializer } from 'prosemirror-markdown';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';

// Matches prosemirror-markdown's default escape of `[[X]]` ->
// `\[\[X\]\]`. Our backlink syntax sits inside plain text and isn't
// meaningful markdown, so we unescape it back to `[[X]]` so the
// backlink extractor + downstream import/export round-trips work.
const ESCAPED_BACKLINK = /\\\[\\\[([^\]\n]+)\\\]\\\]/g;

export function extractMarkdown(ydoc: Y.Doc): string {
  const fragment = ydoc.getXmlFragment('prosemirror');
  if (fragment.length === 0) {
    return '';
  }
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const raw = defaultMarkdownSerializer.serialize(root);
  return raw.replace(ESCAPED_BACKLINK, (_match, inner) => `[[${inner as string}]]`);
}
