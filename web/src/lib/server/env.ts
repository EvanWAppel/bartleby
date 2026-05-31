// Server-side runtime env. Kept in $lib/server/* so SvelteKit's static
// analyzer guarantees these never leak to the client bundle.

export const BARTLEBY_HTTP_URL =
  process.env['BARTLEBY_HTTP_URL'] ??
  `http://127.0.0.1:${process.env['BARTLEBY_HTTP_PORT'] ?? '3000'}`;

/**
 * Shared with the bartleby server (signs the session JWT). Must match
 * the server's SESSION_SECRET; in dev/test both processes read it from
 * the same env value.
 */
export const SESSION_SECRET =
  process.env['SESSION_SECRET'] ??
  // Dev convenience only — production env must override.
  'dev-session-secret-replace-me-in-production-32+chars';

export const SESSION_COOKIE_NAME = 'bartleby_session';
