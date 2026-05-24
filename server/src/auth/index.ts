// Public surface of the auth module.

export { loadAllowlist, type EmailAllowlist, AllowlistConfigError } from './allowlist.js';
export {
  buildSessionConfig,
  issueSessionJwt,
  verifySessionJwt,
  serializeSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SessionConfigError,
  type SessionConfig,
  type SessionClaims,
} from './session.js';
export {
  createInMemorySessionStore,
  type SessionStore,
  type User,
  type UpsertUserInput,
} from './store.js';
export {
  loadGoogleConfig,
  createGoogleClient,
  type GoogleClient,
  type GoogleConfig,
  type GoogleUserInfo,
  GoogleConfigError,
} from './google.js';
export { requireSession, type AuthVars, type RequireSessionDeps } from './middleware.js';
export { createAuthApp, type AuthAppDeps, type AuthAppConfig } from './routes.js';
