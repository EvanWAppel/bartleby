// I-001 markdown parser + frontmatter helpers.

import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseMarkdownToProseMirror, splitFrontmatter } from './parser.js';

describe('splitFrontmatter', () => {
  it('returns null + the whole text when no frontmatter is present', () => {
    const { frontmatter, body } = splitFrontmatter('# heading\n\nbody');
    expect(frontmatter).toBeNull();
    expect(body).toBe('# heading\n\nbody');
  });

  it('extracts a frontmatter block delimited by ---', () => {
    const md = '---\ntitle: Hello\ntags: [a, b]\n---\nbody line';
    const { frontmatter, body } = splitFrontmatter(md);
    expect(frontmatter).toBe('title: Hello\ntags: [a, b]');
    expect(body).toBe('body line');
  });

  it('normalizes CRLF', () => {
    const { frontmatter, body } = splitFrontmatter('---\r\ntitle: Hi\r\n---\r\nbody');
    expect(frontmatter).toBe('title: Hi');
    expect(body).toBe('body');
  });

  it('treats malformed frontmatter (no closing ---) as plain body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntags: [a]\n\nno closing fence');
    expect(frontmatter).toBeNull();
    expect(body).toBe('---\ntags: [a]\n\nno closing fence');
  });
});

describe('parseFrontmatter', () => {
  it('parses an inline-array tags list', () => {
    expect(parseFrontmatter('tags: [travel, cooking]')).toEqual({
      title: null,
      tags: ['travel', 'cooking'],
    });
  });

  it('parses a block-list tags form', () => {
    const fm = 'tags:\n  - travel\n  - cooking\n  - photography';
    expect(parseFrontmatter(fm)).toEqual({
      title: null,
      tags: ['travel', 'cooking', 'photography'],
    });
  });

  it('parses a title line', () => {
    expect(parseFrontmatter('title: My Imported Note')).toEqual({
      title: 'My Imported Note',
      tags: [],
    });
  });

  it('strips matching quotes around a title', () => {
    expect(parseFrontmatter('title: "Quoted Title"').title).toBe('Quoted Title');
    expect(parseFrontmatter("title: 'Single Quotes'").title).toBe('Single Quotes');
  });

  it('dedupes + lowercases tags', () => {
    expect(parseFrontmatter('tags: [Travel, travel, TRAVEL, Cooking]').tags).toEqual([
      'travel',
      'cooking',
    ]);
  });

  it('handles both fields together', () => {
    const fm = 'title: Trip\ntags: [travel, photography]';
    expect(parseFrontmatter(fm)).toEqual({
      title: 'Trip',
      tags: ['travel', 'photography'],
    });
  });
});

describe('parseMarkdownToProseMirror', () => {
  it('parses a paragraph', () => {
    const { doc } = parseMarkdownToProseMirror('hello world');
    expect(doc.firstChild?.type.name).toBe('paragraph');
    expect(doc.textContent).toBe('hello world');
  });

  it('parses a heading', () => {
    const { doc } = parseMarkdownToProseMirror('# the title');
    const heading = doc.firstChild;
    expect(heading?.type.name).toBe('heading');
    expect(heading?.attrs['level']).toBe(1);
    expect(heading?.textContent).toBe('the title');
  });

  it('parses fenced code blocks with a language attr', () => {
    const { doc } = parseMarkdownToProseMirror('```ts\nconst x = 1;\n```');
    const code = doc.firstChild;
    expect(code?.type.name).toBe('code_block');
    expect(code?.attrs['language']).toBe('ts');
    expect(code?.textContent).toBe('const x = 1;');
  });

  it('parses fenced code blocks with no language as language="text"', () => {
    const { doc } = parseMarkdownToProseMirror('```\nplain\n```');
    expect(doc.firstChild?.attrs['language']).toBe('text');
  });

  it('parses bullet + ordered lists', () => {
    const { doc } = parseMarkdownToProseMirror('- first\n- second');
    expect(doc.firstChild?.type.name).toBe('bullet_list');
    expect(doc.firstChild?.childCount).toBe(2);
    const ordered = parseMarkdownToProseMirror('1. first\n2. second').doc;
    expect(ordered.firstChild?.type.name).toBe('ordered_list');
  });

  it('parses inline em + strong + link + code', () => {
    const { doc } = parseMarkdownToProseMirror('a *b* c **d** [link](https://e.f) and `code`');
    const paragraph = doc.firstChild;
    expect(paragraph?.type.name).toBe('paragraph');
    expect(paragraph?.textContent).toBe('a b c d link and code');
    // Sanity check on the marks by inspecting one child node.
    const linkText = paragraph
      ?.toJSON()
      ?.content?.find((c: { text?: string }) => c.text === 'link');
    expect(linkText).toBeDefined();
  });

  it('round-trips title + tags + body in one pass', () => {
    const md =
      '---\ntitle: Imported\ntags: [travel, cooking]\n---\n# My imported note\n\nBody paragraph.';
    const result = parseMarkdownToProseMirror(md);
    expect(result.title).toBe('Imported');
    expect(result.tags).toEqual(['travel', 'cooking']);
    expect(result.doc.firstChild?.type.name).toBe('heading');
    expect(result.doc.firstChild?.textContent).toBe('My imported note');
  });
});
