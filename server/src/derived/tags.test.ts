import { describe, expect, it } from 'vitest';
import { extractTags } from './tags.js';

describe('extractTags (S-009)', () => {
  it('returns empty for empty markdown', () => {
    expect(extractTags('')).toEqual([]);
  });

  it('finds inline #hashtags', () => {
    expect(extractTags('a note about #travel and #cooking').sort()).toEqual(['cooking', 'travel']);
  });

  it('reads YAML frontmatter `tags: [a, b]`', () => {
    const md = `---
tags: [travel, 2026]
---

body`;
    expect(extractTags(md).sort()).toEqual(['2026', 'travel']);
  });

  it('reads YAML frontmatter list form (`- foo`)', () => {
    const md = `---
tags:
  - travel
  - 2026
---

body`;
    expect(extractTags(md).sort()).toEqual(['2026', 'travel']);
  });

  it('unions frontmatter (authoritative) and inline hashtags', () => {
    const md = `---
tags: [travel]
---

body with #cooking and #travel`;
    expect(extractTags(md).sort()).toEqual(['cooking', 'travel']);
  });

  it('deduplicates case-insensitively, preserves first-seen casing', () => {
    expect(extractTags('a #Travel mention then #travel').sort()).toEqual(['Travel']);
  });

  it('ignores `#` in URLs', () => {
    // No hashtag should be extracted from a URL fragment.
    expect(extractTags('see http://example.com/page#section for details')).toEqual([]);
  });

  it('ignores `#` followed by purely digits (looks like a list marker)', () => {
    expect(extractTags('rank #1 and #2')).toEqual([]);
  });

  it('ignores hashtags inside fenced code blocks', () => {
    const md = `before
\`\`\`
not a #tag here
\`\`\`
after #real-tag`;
    expect(extractTags(md)).toEqual(['real-tag']);
  });

  it('ignores hashtags inside inline code', () => {
    expect(extractTags('see `#fragment` and #real')).toEqual(['real']);
  });

  it('tolerates malformed frontmatter (no crash, falls back to inline)', () => {
    const md = `---
tags: [unterminated
---

body with #fallback`;
    expect(extractTags(md)).toEqual(['fallback']);
  });
});
