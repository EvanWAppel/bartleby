// Yjs YDoc -> markdown string. Used by the Hocuspocus onStoreDocument
// hook (S-009) to keep `notes.markdown_export` in sync with the live
// CRDT state so derived state (FTS5, tag extraction, backlink
// extraction) can run on plain text.
//
// The schema must match what the web editor mounts (see ./schema.ts).
// prosemirror-markdown's defaultMarkdownSerializer already handles
// every node we expose (paragraph, heading, blockquote, code_block,
// bullet_list, ordered_list, list_item, horizontal_rule, image,
// hard_break) and every mark except `strike`; we add an entry for
// strike below (`~~text~~`, the CommonMark/GFM convention).
//
// W-010: task_list / task_item serialize as GFM task list syntax
// (`- [ ] foo` / `- [x] done`). renderList prefixes each item with
// `- `; task_item then writes the `[ ] ` / `[x] ` flag before its
// content. Task lists don't have the `tight` attr so we pass through
// the default loose-list flushing — the round-trip preserves shape
// well enough for FTS / backlink extraction, which is all this
// serializer feeds.

import * as Y from 'yjs';
import type { Node } from 'prosemirror-model';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { schema } from './schema.js';

// Matches prosemirror-markdown's default escape of `[[X]]` ->
// `\[\[X\]\]`. Our backlink syntax sits inside plain text and isn't
// meaningful markdown, so we unescape it back to `[[X]]` so the
// backlink extractor + downstream import/export round-trips work.
const ESCAPED_BACKLINK = /\\\[\\\[([^\]\n]+)\\\]\\\]/g;

// MarkdownSerializerState isn't exported as a type from prosemirror-
// markdown; type the callbacks by hand against the bits we use.
interface SerializerState {
  renderList(node: Node, delim: string, firstDelim: (i: number) => string): void;
  renderContent(node: Node): void;
  write(text: string): void;
}

const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    task_list(state: SerializerState, node: Node): void {
      state.renderList(node, '  ', () => '- ');
    },
    task_item(state: SerializerState, node: Node): void {
      const checked = node.attrs['checked'] === true;
      state.write(checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: {
      open: '~~',
      close: '~~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

export function extractMarkdown(ydoc: Y.Doc): string {
  const fragment = ydoc.getXmlFragment('prosemirror');
  if (fragment.length === 0) {
    return '';
  }
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const raw = markdownSerializer.serialize(root);
  return raw.replace(ESCAPED_BACKLINK, (_match, inner) => `[[${inner as string}]]`);
}
