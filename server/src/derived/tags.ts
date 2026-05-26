// Tag extractor (part of S-009). Two sources, in priority order:
//   1. YAML frontmatter `tags: [a, b]` or `tags:\n  - a\n  - b`
//      (authoritative — explicit, no ambiguity).
//   2. Inline `#hashtag` syntax (additive — picks up tags people
//      write inline as they would in Obsidian / Bear).
//
// Frontmatter doesn't suppress inline tags; we union both sets and
// deduplicate case-insensitively. First-seen casing wins so the
// display string reflects what the author actually wrote.
//
// Filtering:
//   - skip hashtags in URL fragments (#section)
//   - skip pure-digit hashtags (#1, #2 — almost always list marker noise)
//   - skip hashtags inside fenced or inline code blocks
//   - require at least one letter so we don't pick up `#_` etc.

import { parse as parseYaml } from 'yaml';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`]*`/g;
const URL = /\bhttps?:\/\/\S+/g;

// `#tag` — a word-char (letter/digit/underscore) plus optional hyphens.
// Anchored on a non-word boundary so `a#b` doesn't match. Requires at
// least one letter so `#1` is filtered.
const HASHTAG = /(?:^|[^\w#])#([A-Za-z][\w-]*)/g;

function stripCodeAndUrls(text: string): string {
  return text.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ').replace(URL, ' ');
}

function fromFrontmatter(md: string): { tags: string[]; bodyStart: number } {
  const match = FRONTMATTER.exec(md);
  if (match === null) {
    return { tags: [], bodyStart: 0 };
  }
  const yamlText = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    // Malformed frontmatter — fall back to body-only extraction. We still
    // consume the frontmatter region so inline-tag scanning doesn't see it.
    return { tags: [], bodyStart: match[0].length };
  }
  const tagsValue =
    parsed !== null && typeof parsed === 'object' && 'tags' in parsed
      ? (parsed as { tags: unknown }).tags
      : undefined;
  if (!Array.isArray(tagsValue)) {
    return { tags: [], bodyStart: match[0].length };
  }
  const tags: string[] = [];
  for (const item of tagsValue) {
    if (typeof item === 'string' && item.length > 0) {
      tags.push(item);
    } else if (typeof item === 'number') {
      tags.push(String(item));
    }
  }
  return { tags, bodyStart: match[0].length };
}

function fromInline(body: string): string[] {
  const cleaned = stripCodeAndUrls(body);
  const tags: string[] = [];
  for (const m of cleaned.matchAll(HASHTAG)) {
    tags.push(m[1]!);
  }
  return tags;
}

export function extractTags(markdown: string): string[] {
  const { tags: front, bodyStart } = fromFrontmatter(markdown);
  const inline = fromInline(markdown.slice(bodyStart));

  // Dedupe case-insensitively, preserve first-seen casing.
  const seen = new Map<string, string>();
  for (const tag of [...front, ...inline]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, tag);
    }
  }
  return [...seen.values()];
}
