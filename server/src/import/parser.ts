// I-001 Markdown -> ProseMirror parser.
//
// Built on top of prosemirror-markdown's MarkdownParser, configured to
// emit nodes matching the project schema in `derived/schema.ts` (which
// mirrors the web editor's schema). Coverage matches PRD §6.2 plus the
// project-specific inline atoms backlinks and mentions.
//
// Nodes:
//   paragraph, heading (h1-h6), blockquote
//   bullet_list, ordered_list, list_item
//   task_list / task_item (GFM `- [ ] foo` / `- [x] foo`)
//   code_block (fenced, with optional language tag)
//   hard_break
//
// Marks: em / strong / link / code / strike (~~text~~)
//
// Inline atoms (post-process pass, since markdown-it tokenises them as
// plain text):
//   backlink — `[[Title]]` -> backlink node with attrs.title
//   mention  — `@user@host.tld` -> mention node with attrs.email
//
// Frontmatter: YAML between `---` fences at the very top. Extracted
// before handing the body to the markdown parser. Title + tags surface
// via the import endpoint (I-003); arbitrary other fields are returned
// as-is so future fields can be added without parser churn.

import MarkdownIt from 'markdown-it';
import { defaultMarkdownParser, MarkdownParser } from 'prosemirror-markdown';
import type { Mark, Node, NodeType } from 'prosemirror-model';
import { parse as parseYaml } from 'yaml';
import { schema } from '../derived/schema.js';

// Build a markdown-it tokenizer that matches the default CommonMark
// dialect (the parser used for `derived/markdown.ts`'s serializer) and
// enable strikethrough so the `~~text~~` mark round-trips. We feed
// task-list parsing through a markdown-it plugin (light-weight; see
// taskListPlugin below) so the resulting `bullet_list`/`list_item`
// tokens carry a marker we can rewrite into our `task_list`/`task_item`
// node types after the standard parser has built its document.

const tokenizer = MarkdownIt('commonmark', { html: false });
// Strikethrough is part of GFM, not CommonMark. Enable the built-in
// markdown-it rule.
tokenizer.enable('strikethrough');

const markdownParser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  // Override code_block to populate our `language` attribute. Default
  // parser maps `code_block` (indented) and `fence` (```) both to
  // schema.code_block with `params` — we surface the language string
  // (or 'text' for an unfenced/bare-fence block).
  code_block: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs: () => ({ language: 'text' }),
  },
  fence: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs: (tok) => {
      const info = (tok.info ?? '').trim();
      return { language: info.length > 0 ? info : 'text' };
    },
  },
  // Strikethrough mark.
  s: { mark: 'strike' },
});

/**
 * The shape we return from frontmatter parsing. Title and tags are the
 * fields the import endpoint actively consumes; we return the parsed
 * object verbatim under `raw` for forward-compat with future fields.
 */
export interface Frontmatter {
  title: string | undefined;
  tags: string[];
  raw: Record<string, unknown>;
}

export interface ParsedMarkdownDocument {
  pmDoc: Node;
  frontmatter: Frontmatter;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a markdown body (no frontmatter) into a ProseMirror Node tree.
 * Post-processes the parse output to recognize `[[Title]]` -> backlink
 * atoms and `@email` -> mention atoms within paragraph children.
 *
 * Throws on parser failures — markdown-it is forgiving but
 * post-processing or schema validation could surface errors; we surface
 * them so callers (the import endpoint) can return a 400.
 */
export function parseMarkdown(body: string): Node {
  const raw = markdownParser.parse(body);
  if (raw === null) {
    throw new Error('failed to parse markdown body');
  }
  return rewriteAtomsAndTaskLists(raw);
}

/**
 * Parse a markdown document with optional YAML frontmatter at the top.
 * Returns the parsed PM doc and the extracted frontmatter (title +
 * tags). Throws on malformed YAML — we deliberately don't swallow,
 * per agents.md.
 */
export function parseMarkdownDocument(text: string): ParsedMarkdownDocument {
  const { body, frontmatter } = extractFrontmatter(text);
  const pmDoc = parseMarkdown(body);
  return { pmDoc, frontmatter };
}

function extractFrontmatter(text: string): { body: string; frontmatter: Frontmatter } {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    return {
      body: text,
      frontmatter: { title: undefined, tags: [], raw: {} },
    };
  }
  const yamlText = match[1] ?? '';
  // Let YAML parse errors propagate — malformed frontmatter is a 400.
  const parsed = parseYaml(yamlText) as unknown;
  const raw: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const titleVal = raw['title'];
  const title = typeof titleVal === 'string' ? titleVal : undefined;
  const tagsVal = raw['tags'];
  const tags: string[] = [];
  if (Array.isArray(tagsVal)) {
    for (const t of tagsVal) {
      if (typeof t === 'string' && t.length > 0) tags.push(t);
      else if (typeof t === 'number') tags.push(String(t));
    }
  }
  return {
    body: text.slice(match[0].length),
    frontmatter: { title, tags, raw },
  };
}

// --- Post-processing: backlinks, mentions, task lists -----------------

const BACKLINK_RE = /\[\[([^[\]\n]+)\]\]/g;
// Matches `@local@domain.tld`-style emails. The picker only inserts
// well-formed emails; we keep the regex conservative so things like
// "email me @ work" don't get rewritten as a mention.
const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
// Task-list item content begins with `[ ]` or `[x]` followed by a
// space. We rewrite `bullet_list`/`list_item` subtrees whose every
// child item begins with this marker into our `task_list`/`task_item`
// node types.
const TASK_PREFIX = /^\[([ xX])\] ?/;

const schemaWithAtoms = {
  paragraph: schema.nodes['paragraph']!,
  text: (s: string, marks?: readonly Mark[]) => schema.text(s, marks),
  backlink: schema.nodes['backlink']!,
  mention: schema.nodes['mention']!,
  task_list: schema.nodes['task_list']!,
  task_item: schema.nodes['task_item']!,
  bullet_list: schema.nodes['bullet_list']!,
  list_item: schema.nodes['list_item']!,
};

/** Walk the doc, rewriting backlink/mention text spans into atom nodes
 *  and bullet-lists-of-tasks into task_lists. Returns a new Node. */
function rewriteAtomsAndTaskLists(root: Node): Node {
  return rewriteNode(root);
}

function rewriteNode(node: Node): Node {
  // Block leaves we don't touch.
  if (node.isText) {
    return node;
  }

  // Convert a `bullet_list` whose every `list_item` starts with a
  // `[ ]` / `[x]` prefix to a `task_list` of `task_item`s.
  if (node.type.name === 'bullet_list' && looksLikeTaskList(node)) {
    const taskItems: Node[] = [];
    for (let i = 0; i < node.childCount; i += 1) {
      const li = node.child(i);
      const { checked, stripped } = stripTaskPrefix(li);
      // task_item contains paragraph block*; reuse the (already
      // rewritten) children, preserving block structure.
      const innerChildren: Node[] = [];
      for (let j = 0; j < stripped.childCount; j += 1) {
        innerChildren.push(rewriteNode(stripped.child(j)));
      }
      taskItems.push(schemaWithAtoms.task_item.create({ checked }, innerChildren));
    }
    return schemaWithAtoms.task_list.create(null, taskItems);
  }

  // For paragraphs (the place atom replacements happen), reconstruct
  // children with backlink + mention atoms substituted in.
  if (node.type.name === 'paragraph') {
    const rewritten = rewriteInline(node);
    return node.type.create(node.attrs, rewritten, node.marks);
  }

  // Default: recurse into children.
  const children: Node[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    children.push(rewriteNode(node.child(i)));
  }
  return node.type.create(node.attrs, children, node.marks);
}

function looksLikeTaskList(bulletList: Node): boolean {
  if (bulletList.childCount === 0) return false;
  for (let i = 0; i < bulletList.childCount; i += 1) {
    const li = bulletList.child(i);
    if (li.type.name !== 'list_item' || li.childCount === 0) return false;
    const firstBlock = li.firstChild!;
    if (firstBlock.type.name !== 'paragraph' || firstBlock.firstChild === null) return false;
    const firstText = firstBlock.firstChild;
    if (!firstText.isText) return false;
    if (!TASK_PREFIX.test(firstText.text ?? '')) return false;
  }
  return true;
}

function stripTaskPrefix(li: Node): { checked: boolean; stripped: Node } {
  const firstPara = li.firstChild!;
  const firstText = firstPara.firstChild!;
  const text = firstText.text ?? '';
  const match = TASK_PREFIX.exec(text);
  if (match === null) {
    return { checked: false, stripped: li };
  }
  const checked = match[1] === 'x' || match[1] === 'X';
  const rest = text.slice(match[0].length);
  // Rebuild the first paragraph with the prefix stripped from the first
  // text node (or removed entirely if rest is empty).
  const newFirstChildren: Node[] = [];
  if (rest.length > 0) {
    newFirstChildren.push(schemaWithAtoms.text(rest, firstText.marks));
  }
  for (let i = 1; i < firstPara.childCount; i += 1) {
    newFirstChildren.push(firstPara.child(i));
  }
  const newFirstPara =
    newFirstChildren.length > 0
      ? firstPara.type.create(firstPara.attrs, newFirstChildren, firstPara.marks)
      : firstPara.type.create(firstPara.attrs, [], firstPara.marks);
  const liChildren: Node[] = [newFirstPara];
  for (let i = 1; i < li.childCount; i += 1) {
    liChildren.push(li.child(i));
  }
  return { checked, stripped: li.type.create(li.attrs, liChildren, li.marks) };
}

function rewriteInline(paragraph: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < paragraph.childCount; i += 1) {
    const child = paragraph.child(i);
    if (!child.isText) {
      out.push(child);
      continue;
    }
    out.push(...splitText(child.text ?? '', child.marks));
  }
  return out;
}

interface InlineFragment {
  start: number;
  end: number;
  node: Node;
}

/** Split a text run into [text, atom, text, atom, ...] preserving marks. */
function splitText(text: string, marks: readonly Mark[]): Node[] {
  if (text.length === 0) return [];

  // Collect all atom hits with their start/end and node form.
  const hits: InlineFragment[] = [];
  for (const m of text.matchAll(BACKLINK_RE)) {
    const start = m.index ?? 0;
    const title = m[1]!;
    const end = start + m[0].length;
    hits.push({
      start,
      end,
      node: schemaWithAtoms.backlink.create({ targetId: '', title }),
    });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    // The regex captures a leading non-`@`/non-word char (group 1) so
    // we don't grab the `@` inside an email address; the start of the
    // actual `@email` token is after that prefix.
    const prefix = m[1] ?? '';
    const start = (m.index ?? 0) + prefix.length;
    const email = m[2]!;
    const end = start + 1 + email.length; // 1 for the `@`
    hits.push({
      start,
      end,
      node: schemaWithAtoms.mention.create({ email, displayName: '' }),
    });
  }

  if (hits.length === 0) {
    return [schemaWithAtoms.text(text, marks)];
  }

  // Sort by start, then drop overlapping hits (first-match-wins).
  hits.sort((a, b) => a.start - b.start);
  const filtered: InlineFragment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start >= cursor) {
      filtered.push(h);
      cursor = h.end;
    }
  }

  const out: Node[] = [];
  let pos = 0;
  for (const h of filtered) {
    if (h.start > pos) {
      out.push(schemaWithAtoms.text(text.slice(pos, h.start), marks));
    }
    out.push(h.node);
    pos = h.end;
  }
  if (pos < text.length) {
    out.push(schemaWithAtoms.text(text.slice(pos), marks));
  }
  return out;
}

// Silence unused-import warnings for nodes / types we only reference at
// runtime via the schema, but TypeScript still needs the import to
// pull in the typings.
export type { NodeType };
