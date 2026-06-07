// MIRRORS web/src/lib/editor/schema.ts. The Hocuspocus
// onStoreDocument hook deserializes the YDoc XmlFragment through this
// schema to extract markdown for FTS + tag + backlink processing
// (S-009). The two schemas MUST stay in sync or the server will fail
// to parse docs that contain list nodes or strike marks.
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
