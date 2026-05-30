// Backlink extractor (part of S-009). Two steps:
//
//   1. `extractBacklinks(markdown)` scans for `[[Title]]` syntax,
//      skipping fenced + inline code blocks, and returns the unique
//      titles in first-seen order.
//   2. `resolveBacklinks(titles, resolve)` calls a title -> note_id
//      lookup for each, drops misses, and shapes the survivors as
//      `BacklinkInput` records ready to feed
//      `backlinks.replaceForSource`.

import type { BacklinkInput } from '../db/repositories/index.js';

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`]*`/g;
const BACKLINK = /\[\[([^[\]\n]+)\]\]/g;

export function extractBacklinks(markdown: string): string[] {
  const stripped = markdown.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ');
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of stripped.matchAll(BACKLINK)) {
    const title = m[1]!.trim();
    if (title.length === 0) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    ordered.push(title);
  }
  return ordered;
}

export type TitleResolver = (title: string) => string | null;

export function resolveBacklinks(titles: string[], resolve: TitleResolver): BacklinkInput[] {
  const out: BacklinkInput[] = [];
  for (const title of titles) {
    const target = resolve(title);
    if (target === null) continue;
    out.push({ target_note_id: target, link_text: title });
  }
  return out;
}
