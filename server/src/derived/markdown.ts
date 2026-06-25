// Yjs YDoc -> markdown string. Dual purpose:
//   - S-009: used by the Hocuspocus onStoreDocument hook to keep
//     `notes.markdown_export` in sync with the live CRDT state so
//     derived state (FTS5, tag extraction, backlink extraction) can
//     run on plain text.
//   - I-002 / I-004: this is also the canonical ProseMirror->Markdown
//     serializer for the import/export round-trip. The import parser
//     (src/import/parser.ts) is the inverse — every node it produces
//     must serialize back through this module, and the round-trip
//     tests in src/import/parser.test.ts pin that invariant.
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
//
// W-011: code_block emits a GFM fenced block (```lang\n…\n```). When
// language is the default 'text', we drop the tag and emit a plain
// fence so the markdown reads naturally in tools that don't recognize
// our "text" sentinel.
//
// W-012: backlink inline atom emits `[[title]]` — the same shape the
// S-009 backlink-extraction regex already keys off. We deliberately
// don't emit the targetId in the markdown: the extractor goes from
// title -> id via noteTitlesHistory, and exporting raw ids would make
// the markdown export brittle to id changes.
//
// W-013: mention inline atom emits `@email`. Email is the stable
// identifier (always present even for un-signed-in allowlist entries)
// and uniquely resolves to a user_id when M-001 later wires up the
// mentions table.

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
  text(text: string, escape?: boolean): void;
  closeBlock(node: Node): void;
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
    code_block(state: SerializerState, node: Node): void {
      const lang = String(node.attrs['language'] ?? 'text');
      const fenceLang = lang === 'text' ? '' : lang;
      state.write('```' + fenceLang + '\n');
      state.text(node.textContent, false);
      state.write('\n```');
      state.closeBlock(node);
    },
    backlink(state: SerializerState, node: Node): void {
      // Emit raw `[[title]]` — `text(..., false)` skips markdown
      // escaping so the brackets don't get backslashed into oblivion.
      state.text(`[[${String(node.attrs['title'])}]]`, false);
    },
    mention(state: SerializerState, node: Node): void {
      // Emit `@email`. We ignore displayName entirely in the markdown
      // form — email is the stable identifier M-001's extractor needs,
      // and embedding displayName would only invite drift after the
      // user renames themselves.
      state.text(`@${String(node.attrs['email'])}`, false);
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
