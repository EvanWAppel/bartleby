// Signed-cookie session (A-003). HS256 JWT in an HttpOnly cookie, signed
// with SESSION_SECRET via jose. Stateless verification on every request;
// revocation is handled by a jti denylist in the in-memory session store
// (A-005, see store.ts).

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export const SESSION_COOKIE_NAME = 'bartleby_session';

/** Seven days. PRD doesn't pin a value; this is conservative for a tiny group. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SESSION_JWT_ISSUER = 'bartleby';
const SESSION_JWT_AUDIENCE = 'bartleby-web';

export interface SessionConfig {
  /** HMAC key bytes derived from SESSION_SECRET. */
  readonly secretKey: Uint8Array;
  /** When true, cookies get the Secure attribute. */
  readonly secureCookies: boolean;
}

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionConfigError';
  }
}

/** Build SessionConfig from env. Throws if SESSION_SECRET is missing/short. */
export function buildSessionConfig(env: Record<string, string | undefined>): SessionConfig {
  const secret = env.SESSION_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new SessionConfigError(
      'SESSION_SECRET is required (used to sign session cookies and tokens).',
    );
  }
  if (secret.length < 32) {
    throw new SessionConfigError(
      'SESSION_SECRET must be at least 32 characters of entropy. ' +
        'Generate one with `openssl rand -base64 48`.',
    );
  }
  const secureCookies = env.NODE_ENV === 'production';
  return {
    secretKey: new TextEncoder().encode(secret),
    secureCookies,
  };
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  email: string;
  displayName: string;
  color: string;
  jti: string;
}

export interface IssueSessionInput {
  userId: string;
  email: string;
  displayName: string;
  color: string;
  jti: string;
  /** Seconds from now. Defaults to SESSION_TTL_SECONDS. */
  ttlSeconds?: number;
}

export async function issueSessionJwt(
  cfg: SessionConfig,
  input: IssueSessionInput,
): Promise<string> {
  const ttl = input.ttlSeconds ?? SESSION_TTL_SECONDS;
  return await new SignJWT({
    email: input.email,
    displayName: input.displayName,
    color: input.color,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(SESSION_JWT_ISSUER)
    .setAudience(SESSION_JWT_AUDIENCE)
    .setSubject(input.userId)
    .setJti(input.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(cfg.secretKey);
}

export async function verifySessionJwt(cfg: SessionConfig, token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, cfg.secretKey, {
    issuer: SESSION_JWT_ISSUER,
    audience: SESSION_JWT_AUDIENCE,
  });
  const sub = payload.sub;
  const jti = payload.jti;
  const email = payload.email;
  const displayName = payload.displayName;
  const color = payload.color;
  if (typeof sub !== 'string' || typeof jti !== 'string') {
    throw new Error('session JWT missing sub or jti');
  }
  if (typeof email !== 'string' || typeof displayName !== 'string' || typeof color !== 'string') {
    throw new Error('session JWT missing user fields');
  }
  return { ...payload, sub, jti, email, displayName, color };
}

export interface SerializeCookieOptions {
  secure: boolean;
  maxAgeSeconds?: number;
}

export function serializeSessionCookie(value: string, opts: SerializeCookieOptions): string {
  const maxAge = opts.maxAgeSeconds ?? SESSION_TTL_SECONDS;
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/** RFC 6265-lite cookie header parser. Sufficient for our own cookies. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  if (header === undefined || header === null || header.length === 0) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k.length > 0) {
      out[k] = v;
    }
  }
  return out;
}
