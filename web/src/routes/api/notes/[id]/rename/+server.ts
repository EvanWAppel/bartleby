// POST /api/notes/[id]/rename — server endpoint backing the title
// editor's form submit. Renames the note via bartleby PATCH /notes/:id
// and 303s back to /n/[id] so the page reloads with the new title.
//
// Form-based intentionally: client-side Svelte 5 event delegation was
// unreliable in our test runtime for input/blur/click events on the
// title editor specifically. Forms use real DOM submit events which
// fire reliably.

import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { renameNote, NotesApiError } from '$lib/api/notes';

export const POST: RequestHandler = async ({ fetch, params, request }) => {
  const id = params['id'];
  if (id === undefined) {
    throw error(400, 'note id required');
  }
  let title: string | undefined;
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const t = form.get('title');
    if (typeof t === 'string') title = t.trim();
  }
  if (title === undefined || title.length === 0) {
    // No-op rename: send the user back to the note unchanged.
    throw redirect(303, `/n/${id}`);
  }
  try {
    await renameNote(id, title, { fetch });
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
