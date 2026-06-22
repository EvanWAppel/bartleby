import { describe, expect, it } from 'vitest';
import { assignZipFilenames, buildExportMarkdown, slugify } from './serializer.js';
import type { NoteRow } from '../db/repositories/index.js';

function row(partial: Partial<NoteRow>): NoteRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Untitled',
    created_by: 'u',
    created_at: '2026-06-22T12:00:00Z',
    updated_at: '2026-06-22T12:00:00Z',
    trashed_at: null,
    markdown_export: '',
    ...partial,
  };
}

describe('buildExportMarkdown', () => {
  it('writes frontmatter with title + tags + body', () => {
    const md = buildExportMarkdown({
      row: row({ title: 'Trip', markdown_export: '# Hello\n\nbody' }),
      tags: ['travel', 'photography'],
    });
    expect(md).toBe(
      ['---', 'title: Trip', 'tags: [travel, photography]', '---', '', '# Hello\n\nbody'].join(
        '\n',
      ),
    );
  });

  it('omits the tags line when there are no tags', () => {
    const md = buildExportMarkdown({
      row: row({ title: 'Plain', markdown_export: 'body' }),
      tags: [],
    });
    expect(md).toBe(['---', 'title: Plain', '---', '', 'body'].join('\n'));
  });

  it('quotes titles with special characters', () => {
    const md = buildExportMarkdown({
      row: row({ title: 'Q3: marketing & ops', markdown_export: 'b' }),
      tags: [],
    });
    expect(md).toContain('title: "Q3: marketing & ops"');
  });

  it('quotes tags with whitespace or punctuation', () => {
    const md = buildExportMarkdown({
      row: row({ title: 't', markdown_export: 'b' }),
      tags: ['friendly tag', 'a:b'],
    });
    expect(md).toContain('tags: ["friendly tag", "a:b"]');
  });
});

describe('slugify', () => {
  it('lowercases and dashes whitespace', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugify('Q3: Marketing & Ops!')).toBe('q3-marketing-ops');
  });

  it('collapses dashes', () => {
    expect(slugify('a--b---c')).toBe('a-b-c');
  });

  it('falls back to "untitled" for empty slugs', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('assignZipFilenames (I-006 collision handling)', () => {
  it('returns clean filenames when slugs are unique', () => {
    const names = assignZipFilenames([
      { id: 'aaaa1111-...', title: 'Trip to Spain' },
      { id: 'bbbb2222-...', title: 'Q3 Plan' },
    ]);
    expect(names).toEqual([
      { id: 'aaaa1111-...', filename: 'trip-to-spain.md' },
      { id: 'bbbb2222-...', filename: 'q3-plan.md' },
    ]);
  });

  it('appends an id suffix to the second-and-later colliding slug', () => {
    const names = assignZipFilenames([
      { id: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Trip' },
      { id: '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: 'TRIP' },
      { id: '33333333-cccc-cccc-cccc-cccccccccccc', title: 'trip' },
    ]);
    expect(names).toEqual([
      { id: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', filename: 'trip.md' },
      { id: '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', filename: 'trip-22222222.md' },
      { id: '33333333-cccc-cccc-cccc-cccccccccccc', filename: 'trip-33333333.md' },
    ]);
  });
});
