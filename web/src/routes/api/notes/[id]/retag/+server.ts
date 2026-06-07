// POST /api/notes/[id]/retag — server endpoint backing the tag chip
// editor's form submits (W-007). Two flavors of caller, distinguished
// by which form fields are present:
//
//   - Chip × (remove): posts only `tags` = "all current tags EXCEPT
//     the removed one", newline-delimited.
//
//   - Add: posts `tags` = "all current tags" + `newtag` = the new tag
//     to append (from the visible <input type="text" name="newtag">).
//
// In both cases we treat the body as full-replacement: parse `tags`,
// append the trimmed `newtag` if present and not already in the set,
// then PATCH bartleby /notes/:id with the resulting array. 303 back
// to /n/[id] so the page reloads with the refreshed chip set.
//
// Newline (not comma) is the `tags` delimiter so tags containing `,`
// round-trip safely; S-004 imposes no character restrictions on tags.
//
// Form-based mirrors W-006 — see rename/+server.ts and the comments
// in TagChipEditor.svelte for the Svelte 5 / Playwright rationale.

import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { retagNote, NotesApiError } from '$lib/api/notes';

function parseTagsField(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split('\n')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export const POST: RequestHandler = async ({ fetch, params, request }) => {
  const id = params['id'];
  if (id === undefined) {
    throw error(400, 'note id required');
  }
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('application/x-www-form-urlencoded')) {
    throw error(415, 'form-encoded body required');
  }
  const form = await request.formData();

  const rawTags = form.get('tags');
  const newtag = form.get('newtag');

  const base = typeof rawTags === 'string' ? parseTagsField(rawTags) : [];
  const seen = new Set(base);
  const final = [...base];
  if (typeof newtag === 'string') {
    const trimmed = newtag.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      final.push(trimmed);
      seen.add(trimmed);
    }
  }

  try {
    await retagNote(id, final, { fetch });
  } catch (e) {
    if (e instanceof NotesApiError) {
      if (e.status === 404) {
        throw error(404, 'Note not found');
      }
      throw error(e.status, e.message);
    }
    throw e;
  }
  throw redirect(303, `/n/${id}`);
};
