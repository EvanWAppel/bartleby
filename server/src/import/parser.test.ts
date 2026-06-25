// I-001 parser tests. Each case round-trips through both the parser
// and the existing serializer (`derived/markdown.ts` extractMarkdown
// after applying the PM doc to a fresh YDoc — same path the S-009 hook
// uses, since the I-002 serializer is the same module).
//
// The parser produces ProseMirror docs that match the schema in
// `derived/schema.ts`. Round-trip is the test: parse(s) -> doc ->
// serialize(doc) ~= s. Whitespace normalization is fine; we don't
// require byte-identical strings, just that markdown that round-trips
// produces the same markdown again after one more cycle (stability).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type { Node } from 'prosemirror-model';
import { extractMarkdown } from '../derived/markdown.js';
import { parseMarkdown, parseMarkdownDocument } from './parser.js';

function serialize(pm: Node): string {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(pm, doc.getXmlFragment('prosemirror'));
  return extractMarkdown(doc);
}

function roundTrip(md: string): string {
  const pm = parseMarkdown(md);
  return serialize(pm);
}

describe('parseMarkdown (I-001) — node coverage', () => {
  it('parses a plain paragraph', () => {
    const pm = parseMarkdown('hello world');
    expect(pm.firstChild?.type.name).toBe('paragraph');
    expect(pm.textContent).toBe('hello world');
  });

  it('round-trips paragraphs', () => {
    expect(roundTrip('hello world')).toBe('hello world');
  });

  it('parses each heading level H1..H6', () => {
    for (let level = 1; level <= 6; level += 1) {
      const md = `${'#'.repeat(level)} title`;
      const pm = parseMarkdown(md);
      const first = pm.firstChild!;
      expect(first.type.name).toBe('heading');
      expect(first.attrs['level']).toBe(level);
      // round-trip stability
      expect(roundTrip(md)).toBe(md);
    }
  });

  it('parses bold/italic/strikethrough marks', () => {
    const md = '**bold** *italic* ~~gone~~';
    const out = roundTrip(md);
    // Marks survive the round-trip; serializer renders ** _ _ ~~.
    expect(out).toContain('**bold**');
    expect(out).toMatch(/[*_]italic[*_]/);
    expect(out).toContain('~~gone~~');
  });

  it('parses links', () => {
    const md = '[ProseMirror](https://prosemirror.net)';
    const pm = parseMarkdown(md);
    expect(pm.textContent).toBe('ProseMirror');
    const para = pm.firstChild!;
    const text = para.firstChild!;
    const linkMark = text.marks.find((m) => m.type.name === 'link');
    expect(linkMark).toBeDefined();
    expect(linkMark!.attrs['href']).toBe('https://prosemirror.net');
    expect(roundTrip(md)).toContain('[ProseMirror](https://prosemirror.net)');
  });

  it('parses bullet lists', () => {
    const md = '* one\n* two';
    const out = roundTrip(md);
    expect(out).toContain('* one');
    expect(out).toContain('* two');
  });

  it('parses ordered lists', () => {
    const md = '1. first\n2. second';
    const out = roundTrip(md);
    expect(out).toContain('1. first');
    expect(out).toContain('2. second');
  });

  it('parses blockquotes', () => {
    const md = '> quoted line';
    const out = roundTrip(md);
    expect(out).toContain('> quoted line');
  });

  it('parses task lists (GFM `- [ ]` / `- [x]`)', () => {
    const md = '- [ ] groceries\n- [x] laundry';
    const pm = parseMarkdown(md);
    const list = pm.firstChild!;
    expect(list.type.name).toBe('task_list');
    expect(list.childCount).toBe(2);
    expect(list.child(0).type.name).toBe('task_item');
    expect(list.child(0).attrs['checked']).toBe(false);
    expect(list.child(1).attrs['checked']).toBe(true);
    const out = roundTrip(md);
    expect(out).toContain('- [ ] groceries');
    expect(out).toContain('- [x] laundry');
  });

  it('parses fenced code blocks with a language tag (W-011)', () => {
    const md = '```ts\nconst x = 1;\n```';
    const pm = parseMarkdown(md);
    const cb = pm.firstChild!;
    expect(cb.type.name).toBe('code_block');
    expect(cb.attrs['language']).toBe('ts');
    expect(cb.textContent).toBe('const x = 1;');
    const out = roundTrip(md);
    expect(out).toContain('```ts');
    expect(out).toContain('const x = 1;');
  });

  it('parses bare fenced code blocks (no language) as language="text"', () => {
    const md = '```\nplain content\n```';
    const pm = parseMarkdown(md);
    const cb = pm.firstChild!;
    expect(cb.type.name).toBe('code_block');
    expect(cb.attrs['language']).toBe('text');
    expect(cb.textContent).toBe('plain content');
  });

  it('parses backlink atoms via [[Title]] syntax (W-012)', () => {
    const md = 'see [[Trip to Spain]] for details';
    const pm = parseMarkdown(md);
    // Walk inline children of the single paragraph.
    const para = pm.firstChild!;
    const types = [];
    for (let i = 0; i < para.childCount; i += 1) {
      types.push(para.child(i).type.name);
    }
    expect(types).toContain('backlink');
    const backlink = (() => {
      for (let i = 0; i < para.childCount; i += 1) {
        const c = para.child(i);
        if (c.type.name === 'backlink') return c;
      }
      throw new Error('no backlink');
    })();
    expect(backlink.attrs['title']).toBe('Trip to Spain');
    expect(roundTrip(md)).toBe('see [[Trip to Spain]] for details');
  });

  it('parses mention atoms via @email syntax (W-013)', () => {
    const md = 'cc @alice@example.com on this';
    const pm = parseMarkdown(md);
    const para = pm.firstChild!;
    let mention: Node | null = null;
    for (let i = 0; i < para.childCount; i += 1) {
      const c = para.child(i);
      if (c.type.name === 'mention') {
        mention = c;
        break;
      }
    }
    expect(mention).not.toBeNull();
    expect(mention!.attrs['email']).toBe('alice@example.com');
    expect(roundTrip(md)).toBe('cc @alice@example.com on this');
  });
});

describe('parseMarkdownDocument (I-001) — frontmatter', () => {
  it('returns the parsed doc and an empty frontmatter when no `---` block present', () => {
    const result = parseMarkdownDocument('just a paragraph');
    expect(result.pmDoc.firstChild?.type.name).toBe('paragraph');
    expect(result.frontmatter.title).toBeUndefined();
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('parses YAML frontmatter title + tags', () => {
    const md = ['---', 'title: My Trip', 'tags: [travel, spain]', '---', '', '# heading'].join(
      '\n',
    );
    const result = parseMarkdownDocument(md);
    expect(result.frontmatter.title).toBe('My Trip');
    expect(result.frontmatter.tags).toEqual(['travel', 'spain']);
    expect(result.pmDoc.firstChild?.type.name).toBe('heading');
  });

  it('parses YAML block-style tags', () => {
    const md = ['---', 'title: Notes', 'tags:', '  - a', '  - b', '---', '', 'body'].join('\n');
    const result = parseMarkdownDocument(md);
    expect(result.frontmatter.tags).toEqual(['a', 'b']);
  });

  it('handles a quoted title containing special characters', () => {
    const md = ['---', 'title: "Q3 plan: ops & marketing"', '---', '', 'body'].join('\n');
    const result = parseMarkdownDocument(md);
    expect(result.frontmatter.title).toBe('Q3 plan: ops & marketing');
  });

  it('throws on malformed YAML rather than silently swallowing', () => {
    // do not hide or wrap errors — agents.md.
    const md = ['---', 'title: "unclosed', '---', '', 'body'].join('\n');
    expect(() => parseMarkdownDocument(md)).toThrow();
  });
});
