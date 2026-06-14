// MIRRORS web/src/lib/editor/schema.ts. The Hocuspocus onStoreDocument
// hook deserializes the YDoc XmlFragment through this schema to extract
// markdown for FTS + tag + backlink processing (S-009). The two schemas
// MUST stay in sync or the server will fail to parse docs that contain
// list nodes, strike marks, or task items.
//
// When a shared monorepo package for editor utilities lands (likely
// alongside I-001/I-002's markdown parser), promote this module there
// and have both web and server import it.

import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec } from 'prosemirror-model';
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

const taskListNode: NodeSpec = {
  group: 'block',
  content: 'task_item+',
  parseDOM: [{ tag: 'ul[data-type="task-list"]' }],
  toDOM(): [string, Record<string, string>, number] {
    return ['ul', { 'data-type': 'task-list' }, 0];
  },
};

const taskItemNode: NodeSpec = {
  attrs: { checked: { default: false } },
  content: 'paragraph block*',
  defining: true,
  parseDOM: [
    {
      tag: 'li[data-type="task-item"]',
      getAttrs(el): Record<string, unknown> {
        // The server tsconfig deliberately doesn't pull lib.dom in
        // (the server never parses DOM — extractMarkdown runs through
        // y-prosemirror's YXmlFragment → Node path, not DOM). Type via
        // the minimum structural shape getAttrs needs so the schema
        // still compiles under @types/node alone.
        const checked = (el as { getAttribute(name: string): string | null }).getAttribute(
          'data-checked',
        );
        return { checked: checked === 'true' };
      },
    },
  ],
  toDOM(node): [string, Record<string, string>, number] {
    return [
      'li',
      {
        'data-type': 'task-item',
        'data-checked': String(node.attrs['checked']),
      },
      0,
    ];
  },
};

const nodesWithLists = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
const nodes = nodesWithLists.append({
  task_list: taskListNode,
  task_item: taskItemNode,
});
const marks = basicSchema.spec.marks.addToEnd('strike', strikeMark);

export const schema = new Schema({ nodes, marks });
