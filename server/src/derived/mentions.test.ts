import { describe, expect, it } from 'vitest';
import { extractMentionEmails } from './mentions.js';

describe('extractMentionEmails (M-001 / M-002)', () => {
  it('extracts a single mention from a paragraph', () => {
    expect(extractMentionEmails('cc @alice@example.com on this')).toEqual(['alice@example.com']);
  });

  it('extracts multiple distinct mentions, lowercase + deduped', () => {
    const md = '@Alice@example.com see @bob@example.com and @ALICE@example.com again';
    expect(extractMentionEmails(md).sort()).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('mention at the start of the markdown matches', () => {
    expect(extractMentionEmails('@alice@example.com kicks off')).toEqual(['alice@example.com']);
  });

  it('ignores `@email` strings that are not preceded by a whitespace boundary', () => {
    // foo@alice@... is not a mention — the @ is part of a word.
    expect(extractMentionEmails('hello foo@alice@example.com')).toEqual([]);
  });

  it('handles multi-line markdown', () => {
    const md = `a line\n@alice@example.com\nand more`;
    expect(extractMentionEmails(md)).toEqual(['alice@example.com']);
  });

  it('returns empty for markdown with no mentions', () => {
    expect(extractMentionEmails('plain prose. no @ tokens.')).toEqual([]);
  });

  it('does not match bare `@word` without a domain', () => {
    expect(extractMentionEmails('@alice and @bob without domains')).toEqual([]);
  });

  it('handles subdomains', () => {
    expect(extractMentionEmails('cc @alice@mail.example.com')).toEqual(['alice@mail.example.com']);
  });
});
