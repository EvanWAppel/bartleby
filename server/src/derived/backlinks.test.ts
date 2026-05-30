import { describe, expect, it } from 'vitest';
import { extractBacklinks, resolveBacklinks } from './backlinks.js';

describe('extractBacklinks (S-009)', () => {
  it('returns empty for empty markdown', () => {
    expect(extractBacklinks('')).toEqual([]);
  });

  it('extracts a single [[Title]]', () => {
    expect(extractBacklinks('see [[Trip to Spain]] for details')).toEqual(['Trip to Spain']);
  });

  it('extracts multiple links and preserves order', () => {
    expect(extractBacklinks('linked: [[A]], [[B]], and [[C]]')).toEqual(['A', 'B', 'C']);
  });

  it('deduplicates exact-match repeats', () => {
    expect(extractBacklinks('[[X]] then again [[X]]')).toEqual(['X']);
  });

  it('trims whitespace inside the brackets', () => {
    expect(extractBacklinks('[[  Spaced Title  ]]')).toEqual(['Spaced Title']);
  });

  it('ignores [[link]] inside fenced code blocks', () => {
    const md = `before
\`\`\`
[[code-block-link]] here
\`\`\`
after [[real-link]]`;
    expect(extractBacklinks(md)).toEqual(['real-link']);
  });

  it('ignores [[link]] inside inline code', () => {
    expect(extractBacklinks('see `[[ignored]]` and [[real]]')).toEqual(['real']);
  });

  it('does not match malformed brackets', () => {
    expect(extractBacklinks('[ [not a link] ] and [[unterminated')).toEqual([]);
  });
});

describe('resolveBacklinks (S-009)', () => {
  it('looks up each title via the resolver and emits BacklinkInput[]', () => {
    const titles = ['A', 'B', 'C'];
    const resolve = (title: string): string | null => {
      if (title === 'A') return 'note-a';
      if (title === 'C') return 'note-c';
      return null;
    };
    const result = resolveBacklinks(titles, resolve);
    expect(result).toEqual([
      { target_note_id: 'note-a', link_text: 'A' },
      { target_note_id: 'note-c', link_text: 'C' },
    ]);
  });

  it('drops unresolved titles silently (no entry for "B")', () => {
    const result = resolveBacklinks(['A', 'B'], (t) => (t === 'A' ? 'note-a' : null));
    expect(result.map((b) => b.target_note_id)).toEqual(['note-a']);
  });

  it('preserves duplicate link_text targeting the same note', () => {
    // (the extractor itself dedupes by title, so this is only relevant
    // if the resolver maps two distinct titles to the same note id.)
    const result = resolveBacklinks(['A', 'Alias'], (_t) => 'note-a');
    expect(result).toEqual([
      { target_note_id: 'note-a', link_text: 'A' },
      { target_note_id: 'note-a', link_text: 'Alias' },
    ]);
  });
});
