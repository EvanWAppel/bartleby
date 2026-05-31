// If you're already signed in and you hit /login, bounce to where you
// were going (or `/`).

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user !== undefined) {
    const next = url.searchParams.get('next') ?? '/';
    throw redirect(303, sanitizeNext(next));
  }
  const next = url.searchParams.get('next') ?? '/';
  return { next: sanitizeNext(next) };
};

function sanitizeNext(next: string): string {
  // Refuse off-site redirects.
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
