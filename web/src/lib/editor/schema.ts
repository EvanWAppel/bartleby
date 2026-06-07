// Bartleby editor schema = prosemirror-schema-basic + list nodes (ul,
// ol, li) from prosemirror-schema-list + a custom `strike` mark.
//
// MIRRORS server/src/derived/schema.ts. The Hocuspocus onStoreDocument
// hook deserializes the YDoc XmlFragment through ProseMirror's schema
// to extract markdown for FTS + tag + backlink processing (S-009); the
// two schemas MUST stay in sync or the server will fail to parse docs
// that contain list nodes or strike marks.
//
// When a shared monorepo package for editor utilities lands (likely
// alongside I-001/I-002's markdown parser), promote this module there
// and have both web and server import it.

import { Schema } from 'prosemirror-model';
import type { MarkSpec } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

const strikeMark: MarkSpec = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { tag: 'strike' },
    { style: 'text-decoration=line-through' },
  ],
  toDOM(): [string, number] {
    return ['s', 0];
  },
};

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
const marks = basicSchema.spec.marks.addToEnd('strike', strikeMark);

export const schema = new Schema({ nodes, marks });

export type ToolbarMarkName = 'strong' | 'em' | 'strike' | 'link' | 'code';
export type ToolbarBlockName =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet_list'
  | 'ordered_list'
  | 'blockquote'
  | 'code_block';

// Re-export node + mark types as a typed convenience so the toolbar
// doesn't have to keep using string keys + non-null assertions.
export const nodeTypes = {
  paragraph: schema.nodes['paragraph']!,
  heading: schema.nodes['heading']!,
  blockquote: schema.nodes['blockquote']!,
  code_block: schema.nodes['code_block']!,
  bullet_list: schema.nodes['bullet_list']!,
  ordered_list: schema.nodes['ordered_list']!,
  list_item: schema.nodes['list_item']!,
} as const;

export const markTypes = {
  strong: schema.marks['strong']!,
  em: schema.marks['em']!,
  link: schema.marks['link']!,
  code: schema.marks['code']!,
  strike: schema.marks['strike']!,
} as const;

// Sanity guard: assert at module load time that the schema actually
// contains every type we claim above. Catches accidental schema
// drift (e.g., a future refactor that drops a node) at boot rather
// than in a confusing toolbar click that silently no-ops.
for (const [key, value] of Object.entries(nodeTypes)) {
  if (value === undefined) {
    throw new Error(`editor schema missing node type: ${key}`);
  }
}
for (const [key, value] of Object.entries(markTypes)) {
  if (value === undefined) {
    throw new Error(`editor schema missing mark type: ${key}`);
  }
}
