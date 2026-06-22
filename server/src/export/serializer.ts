// I-004 / I-005 export helpers: build the markdown payload (with
// frontmatter) for a single note. Reused by the single-note export
// endpoint and the zip-all endpoint.
//
// The body comes from `notes.markdown_export` which the S-009 hook
// keeps in sync with the live Yjs state on every save. Newly imported
// notes also have markdown_export populated (eventually, after the
// first save) — for v1 we accept that a never-opened, freshly-imported
// note may export with an empty body until the user touches it.

import type { NoteRow } from '../db/repositories/index.js';

export interface ExportableNote {
  row: NoteRow;
  tags: string[];
}

/**
 * Build a `.md` payload for one note: a YAML frontmatter block with
 * `title` + `tags`, then the markdown body. We escape the title in
 * double quotes — a title containing a `:` or newline would otherwise
 * break the parse on a future re-import.
 */
export function buildExportMarkdown(note: ExportableNote): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${quote(note.row.title)}`);
  if (note.tags.length > 0) {
    lines.push(`tags: [${note.tags.map(quote).join(', ')}]`);
  }
  lines.push('---', '');
  lines.push(note.row.markdown_export);
  return lines.join('\n');
}

function quote(s: string): string {
  // Plain values are fine when they don't contain special chars or
  // any whitespace. Otherwise wrap in double quotes + escape the
  // inner ones. (We quote on any whitespace, not just leading/trailing
  // — a tag like "friendly tag" needs to round-trip through the
  // import frontmatter parser, which split-on-`,`s and ignores
  // surrounding whitespace; without quotes the renderer here is fine
  // but unrelated YAML parsers would balk.)
  if (/[\s:#"'\\\n]/.test(s) || s.length === 0) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Slugify a note title for use as a zip-entry filename. Strips
 * everything outside `[a-z0-9-]`, collapses runs of dashes, trims
 * leading/trailing dashes. Returns `untitled` when the slug ends up
 * empty (e.g., title was all punctuation).
 *
 * I-006 collision handling lives in `assignZipFilenames` — slugify
 * itself produces a best-effort base, callers handle dupes.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\s-]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'untitled';
}

/**
 * I-006 collision handling: given an ordered list of notes, return
 * unique `.md` filenames per note. When two slugified titles collide
 * (e.g., "Trip" and "trip"), the second-and-later one gets a short
 * id-suffix appended (`-<first-8-chars-of-uuid>`).
 *
 * The first note with a given slug keeps the plain slug — that way
 * the most common case (no collisions) produces clean filenames; only
 * the actual collisions pay the suffix.
 */
export function assignZipFilenames(
  notes: { id: string; title: string }[],
): { id: string; filename: string }[] {
  const seen = new Set<string>();
  const out: { id: string; filename: string }[] = [];
  for (const n of notes) {
    const slug = slugify(n.title);
    let filename = `${slug}.md`;
    if (seen.has(filename)) {
      filename = `${slug}-${n.id.slice(0, 8)}.md`;
    }
    seen.add(filename);
    out.push({ id: n.id, filename });
  }
  return out;
}
