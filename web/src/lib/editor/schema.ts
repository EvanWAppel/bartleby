// Bartleby editor schema = prosemirror-schema-basic + list nodes (ul,
// ol, li) from prosemirror-schema-list + a custom `strike` mark +
// W-010 task list nodes (task_list, task_item with a `checked` attr) +
// W-011 overrides code_block to carry a `language` attr +
// W-012 adds a `backlink` inline atom node (targetId + title) that
// renders as a clickable <a> and round-trips to `[[title]]` in markdown +
// W-013 adds a `mention` inline atom node (email + displayName) that
// renders as a styled <span> and round-trips to `@email` in markdown.
//
// MIRRORS server/src/derived/schema.ts. The Hocuspocus onStoreDocument
// hook deserializes the YDoc XmlFragment through ProseMirror's schema
// to extract markdown for FTS + tag + backlink processing (S-009); the
// two schemas MUST stay in sync or the server will fail to parse docs
// that contain list nodes, strike marks, task items, code block
// language tags, or backlink nodes.
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

// W-010: task_list / task_item. Modeled as a separate node-type pair
// from bullet_list / list_item so the markdown serializer (and any
// future toolbar entry) can distinguish them without inspecting
// per-item attrs. data-type attributes on the DOM let CSS + Playwright
// tests target task lists without ambiguity vs. regular <ul>/<li>.
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
        const checked = (el as Element).getAttribute('data-checked');
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

// W-011: override the basic code_block to carry a `language` attr.
// Default 'text' means "no syntax highlighting" — the markdown
// serializer also drops the language tag in that case so the round-
// tripped fence is plain ```. data-language on <pre> drives both the
// CSS hook and the highlight plugin's per-block dispatch.
const codeBlockNode: NodeSpec = {
  attrs: { language: { default: 'text' } },
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs(el): Record<string, unknown> {
        const lang = (el as HTMLElement).getAttribute?.('data-language');
        return { language: lang === null || lang === undefined || lang === '' ? 'text' : lang };
      },
    },
  ],
  toDOM(node): [string, Record<string, string>, [string, number]] {
    return ['pre', { 'data-language': String(node.attrs['language']) }, ['code', 0]];
  },
};

// W-012: backlink is an inline atom node carrying a stable target id
// (so renames don't break the link) and the title shown at insert time
// (so the rendered <a> doesn't need a server round-trip just to label
// itself). Atoms are non-editable as a unit — backspace removes the
// whole node, which matches the Obsidian/Notion mental model.
//
// Round-trip: the markdown serializer emits `[[title]]` so the S-009
// onStoreDocument hook's existing backlink-extraction regex picks it
// up unchanged. parseDOM here only matters for HTML paste / SSR, since
// y-prosemirror's CRDT path uses node names + attrs directly.
const backlinkNode: NodeSpec = {
  attrs: {
    targetId: { default: '' },
    title: { default: '' },
  },
  group: 'inline',
  inline: true,
  atom: true,
  parseDOM: [
    {
      tag: 'a[data-backlink]',
      getAttrs(el): Record<string, unknown> {
        const e = el as HTMLElement;
        return {
          targetId: e.getAttribute('data-backlink-target') ?? '',
          title: e.textContent ?? '',
        };
      },
    },
  ],
  toDOM(node): [string, Record<string, string>, string] {
    const targetId = String(node.attrs['targetId']);
    const title = String(node.attrs['title']);
    return [
      'a',
      {
        'data-backlink': '',
        'data-backlink-target': targetId,
        href: `/n/${targetId}`,
      },
      title,
    ];
  },
};

// W-013: mention is an inline atom node carrying a stable email (works
// even for allowlist entries that haven't signed in yet — no FK to fake
// up) and the displayName captured at insert time (so the rendered
// chip doesn't need a server round-trip to label itself). Atoms are
// non-editable as a unit — backspace removes the whole chip.
//
// Round-trip: the markdown serializer emits `@email` so M-001's
// mention-extraction step has a stable identifier that uniquely resolves
// to a user_id without depending on display names (which collide and
// drift on rename).
const mentionNode: NodeSpec = {
  attrs: {
    email: { default: '' },
    displayName: { default: '' },
  },
  group: 'inline',
  inline: true,
  atom: true,
  parseDOM: [
    {
      tag: 'span[data-mention]',
      getAttrs(el): Record<string, unknown> {
        const e = el as HTMLElement;
        return {
          email: e.getAttribute('data-mention-email') ?? '',
          displayName: e.getAttribute('data-mention-display') ?? '',
        };
      },
    },
  ],
  toDOM(node): [string, Record<string, string>, string] {
    const email = String(node.attrs['email']);
    const displayName = String(node.attrs['displayName']);
    const label = displayName.length > 0 ? `@${displayName}` : `@${email}`;
    return [
      'span',
      {
        'data-mention': '',
        'data-mention-email': email,
        'data-mention-display': displayName,
      },
      label,
    ];
  },
};

const nodesWithLists = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
const nodes = nodesWithLists.update('code_block', codeBlockNode).append({
  task_list: taskListNode,
  task_item: taskItemNode,
  backlink: backlinkNode,
  mention: mentionNode,
});
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
  task_list: schema.nodes['task_list']!,
  task_item: schema.nodes['task_item']!,
  backlink: schema.nodes['backlink']!,
  mention: schema.nodes['mention']!,
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
