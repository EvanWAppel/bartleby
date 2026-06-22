// I-001 markdown → ProseMirror parser. Configured against our derived
// schema so the parser produces nodes the rest of the pipeline
// understands. We deliberately stay close to commonmark + the
// defaults from prosemirror-markdown: anything that doesn't have a
// dedicated token (strike, task list, language fences without GFM
// support) falls through as plain text and is re-processed by the
// derived-state hook on the first save. That's a perfectly good
// degradation — the imported doc renders, the user can re-format as
// needed.
//
// Frontmatter handling: we strip a YAML-style block (between two
// `---` lines at the top of the file) and parse only `title` and
// `tags` from it. A `tags:` line supports both the inline-array form
// `tags: [a, b]` and the YAML block-list `tags:\n  - a\n  - b`. PRD
// §6.2 requires this so users importing existing markdown with
// frontmatter don't lose their tag set.

import MarkdownIt from 'markdown-it';
import { MarkdownParser, type ParseSpec } from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../derived/schema.js';

export interface ParsedMarkdown {
  /** ProseMirror doc node (top-level `doc`). */
  doc: PMNode;
  /** Title extracted from frontmatter; null if no `title:` line. */
  title: string | null;
  /** Tags extracted from frontmatter; empty if none. Always
   * lowercased + deduped. */
  tags: string[];
}

const FRONTMATTER_DELIMITER = '---';

/**
 * Split a markdown string into its frontmatter (if any) and body.
 * The frontmatter block must start at the very beginning of the file
 * with `---` on its own line and close with another `---` on its own
 * line; any other layout is treated as plain body.
 */
export function splitFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  // Normalize Windows line endings; everything downstream assumes \n.
  const text = markdown.replace(/\r\n/g, '\n');
  if (!text.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { frontmatter: null, body: text };
  }
  const closeIdx = text.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1);
  if (closeIdx < 0) {
    return { frontmatter: null, body: text };
  }
  const frontmatter = text.slice(FRONTMATTER_DELIMITER.length + 1, closeIdx);
  const body = text.slice(closeIdx + FRONTMATTER_DELIMITER.length + 2);
  return { frontmatter, body };
}

/**
 * Parse a YAML-ish frontmatter block for `title` and `tags`. We don't
 * pull in a full YAML library — frontmatter in v1 is exactly two
 * fields and the supported shapes are small. Anything else is
 * ignored.
 */
export function parseFrontmatter(frontmatter: string): { title: string | null; tags: string[] } {
  let title: string | null = null;
  const tags: string[] = [];
  const lines = frontmatter.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const titleMatch = /^title:\s*(.*?)\s*$/.exec(line);
    if (titleMatch !== null && titleMatch[1] !== undefined) {
      title = stripQuotes(titleMatch[1]).trim();
      if (title.length === 0) title = null;
      continue;
    }
    // `tags: [a, b]` — inline-array form.
    const inlineTags = /^tags:\s*\[(.*?)\]\s*$/.exec(line);
    if (inlineTags !== null) {
      const inner = inlineTags[1] ?? '';
      for (const t of inner.split(',')) {
        const v = stripQuotes(t.trim());
        if (v.length > 0) tags.push(v.toLowerCase());
      }
      continue;
    }
    // `tags:` followed by a YAML block list of `- value` items.
    if (/^tags:\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length) {
        const m = /^\s*-\s*(.+?)\s*$/.exec(lines[j]!);
        if (m === null) break;
        const v = stripQuotes(m[1]!).trim();
        if (v.length > 0) tags.push(v.toLowerCase());
        j += 1;
      }
      i = j - 1;
    }
  }
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      deduped.push(t);
    }
  }
  return { title, tags: deduped };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// markdown-it token → schema node/mark spec. Mirrors
// prosemirror-markdown's defaultMarkdownParser tokens but uses
// `language` instead of `params` on the fence block (our code_block
// node calls the attr `language`, per W-011).
const TOKEN_SPEC: Record<string, ParseSpec> = {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list', getAttrs: (tok) => ({ tight: looksTight(tok) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok) => ({
      order: Number(tok.attrGet('start')) || 1,
      tight: looksTight(tok),
    }),
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: {
    block: 'code_block',
    getAttrs: (tok) => ({ language: tok.info?.trim() || 'text' }),
    noCloseToken: true,
  },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') ?? null,
      alt:
        (tok.children !== null && tok.children !== undefined && tok.children[0] !== undefined
          ? tok.children[0].content
          : '') ?? null,
    }),
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({
      href: tok.attrGet('href'),
      title: tok.attrGet('title') ?? null,
    }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
};

function looksTight(tok: { hidden?: boolean }): boolean {
  // markdown-it emits a `paragraph_open` with `hidden: true` for tight
  // lists; the absence/presence flows through to the list token itself
  // as `tight`. We accept either signal — the default rendering tracks
  // it via getAttrs on the list block.
  return tok.hidden === true;
}

const md = MarkdownIt('commonmark', { html: false });
export const importMarkdownParser = new MarkdownParser(schema, md, TOKEN_SPEC);

export function parseMarkdownToProseMirror(markdown: string): ParsedMarkdown {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const meta =
    frontmatter !== null ? parseFrontmatter(frontmatter) : { title: null, tags: [] as string[] };
  const doc = importMarkdownParser.parse(body);
  if (doc === null) {
    throw new Error('failed to parse markdown body');
  }
  return { doc, title: meta.title, tags: meta.tags };
}
