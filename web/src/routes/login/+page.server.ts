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

  // Dev-only sign-in shortcut. Mirrors the server's ALLOW_TEST_SIGN_IN
  // gate: the bartleby server only mounts POST /auth/dev/sign-in when
  // that flag is set, so we only surface the button under the same
  // condition. NEVER true in a production build. The default email is
  // seeded from the first allowlisted address for one-click convenience.
  const devSignIn = process.env['ALLOW_TEST_SIGN_IN'] === 'true';
  const devEmail = devSignIn
    ? (process.env['BARTLEBY_ALLOWED_EMAILS']?.split(',')[0]?.trim() ?? '')
    : '';

  return { next: sanitizeNext(next), devSignIn, devEmail };
};

function sanitizeNext(next: string): string {
  // Refuse off-site redirects.
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
