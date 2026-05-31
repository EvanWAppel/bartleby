// Auth gate: validate the session cookie LOCALLY (no /auth/me round-trip)
// using the same SESSION_SECRET the bartleby server uses to sign it.
//
// Why not /auth/me? A's SessionStore is still in-memory per A's TODO —
// a user only lands in it via the real OAuth callback. Tests + dev
// can't realistically perform that callback. JWT-validate-locally
// gives SvelteKit a self-sufficient auth gate without depending on
// the server's in-memory state. The bartleby server still enforces
// the same gate on its /notes etc. routes independently — and once A
// swaps SessionStore for the D-backed store, both sides will agree
// on the same user identity automatically.
//
// Public routes (anything under PUBLIC_PREFIXES) skip the check.
// Protected routes redirect unauthed users to /login, preserving the
// originally requested path as ?next=... so we can bounce back after
// sign-in.

import { redirect, type Handle } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE_NAME, SESSION_SECRET } from '$lib/server/env';

const PUBLIC_PREFIXES = ['/login', '/auth/'] as const;
const SESSION_JWT_ISSUER = 'bartleby';
const SESSION_JWT_AUDIENCE = 'bartleby-web';

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  color: string;
}

function isPublic(pathname: string): boolean {
  if (pathname === '/') return false;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function cookieValue(rawCookie: string | null, name: string): string | null {
  if (rawCookie === null) return null;
  for (const part of rawCookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

async function verifyAndUnpack(token: string): Promise<SessionUser | null> {
  const secretKey = new TextEncoder().encode(SESSION_SECRET);
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: SESSION_JWT_ISSUER,
      audience: SESSION_JWT_AUDIENCE,
    });
    const sub = payload.sub;
    const email = payload['email'];
    const displayName = payload['displayName'];
    const color = payload['color'];
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      typeof displayName !== 'string' ||
      typeof color !== 'string'
    ) {
      return null;
    }
    return { id: sub, email, display_name: displayName, color };
  } catch {
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const cookie = event.request.headers.get('cookie');
  const token = cookieValue(cookie, SESSION_COOKIE_NAME);
  if (token !== null) {
    const user = await verifyAndUnpack(token);
    if (user !== null) {
      event.locals.user = user;
    }
  }

  if (!isPublic(event.url.pathname) && event.locals.user === undefined) {
    const next = encodeURIComponent(event.url.pathname + event.url.search);
    throw redirect(303, `/login?next=${next}`);
  }

  return resolve(event);
};
