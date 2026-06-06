// Fetch the note's metadata (id, title, tags) so the title editor and
// future panes don't have to wait for a client-side roundtrip. 404
// surfaces as a SvelteKit 404 via `error()`.

import { error } from '@sveltejs/kit';
import { getNote, NotesApiError } from '$lib/api/notes';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    const note = await getNote(params.id, { fetch });
    return { id: params.id, note };
  } catch (e) {
    if (e instanceof NotesApiError && e.status === 404) {
      throw error(404, 'Note not found');
    }
    throw e;
  }
};
