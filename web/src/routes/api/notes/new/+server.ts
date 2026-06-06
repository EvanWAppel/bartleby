// POST /notes/new — server-side note creation that the sidebar form
// submits to. Proxies to the bartleby API (POST /notes) using the
// SvelteKit fetch (which forwards the session cookie), then 303s to
// /n/[new-id].
//
// This route exists because client-side `onclick` event delegation in
// Svelte 5 + Playwright was unreliable in our test environment. Real
// user clicks would have worked, but a server-action submit is more
// robust either way: refreshes work, no-JS works, and the navigation
// is guaranteed atomic.

import { redirect, type RequestHandler } from '@sveltejs/kit';
import { createNote, NotesApiError } from '$lib/api/notes';

export const POST: RequestHandler = async ({ fetch, request }) => {
  // Accept an optional title via form-encoded body.
  let title: string | undefined;
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const t = form.get('title');
    if (typeof t === 'string' && t.trim().length > 0) title = t.trim();
  }
  try {
    const note = await createNote(title, { fetch });
    throw redirect(303, `/n/${note.id}`);
  } catch (e) {
    if (e instanceof NotesApiError) {
      return new Response(JSON.stringify({ error: { code: e.code, message: e.message } }), {
        status: e.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw e;
  }
};
