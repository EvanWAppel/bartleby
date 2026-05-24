# @bartleby/server

Node + Hocuspocus collaboration server + REST API. SQLite storage. See top-level [`PRD.md`](../PRD.md) §7.3.

## Quick start

```sh
npm install
cp .env.example .env   # then edit .env (see "Environment" below)
npm run dev            # tsx watch
npm test               # vitest
npm run lint
npm run typecheck
```

## Stack

- TypeScript (ESM, Node 22+).
- Hocuspocus for Yjs collaboration over WebSocket.
- Hono on `@hono/node-server` for REST/auth routes.
- `jose` for HS256-signed session JWTs.
- SQLite via `better-sqlite3` (added in V-010).
- Vitest for tests.
- ESLint flat config + Prettier.

## Environment

All variables are documented in [`.env.example`](./.env.example). The server
refuses to start if any required var is missing (loud failure at boot).
Required for Workstream A:

- `BARTLEBY_ALLOWED_EMAILS` — comma-separated allowlist (PRD §9.1).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth web client.
- `SESSION_SECRET` — 32+ chars of entropy for JWT signing.
- `PUBLIC_BASE_URL` — external base URL (used to build the OAuth redirect URI).

## Auth (Workstream A) — current state

PR 1 ships `A-001..A-005`:

- `GET  /auth/google/start` — sets an OAuth state cookie, 302s to Google.
- `GET  /auth/google/callback` — exchanges code, fetches userinfo, enforces
  the allowlist, upserts user, mints a session JWT, sets cookie, 302s home.
- `GET  /auth/me` — current user (id, email, display_name, color) or 401.
- `POST /auth/logout` — revokes the session jti and clears the cookie.

The session is a `jose` HS256 JWT stored in an HttpOnly cookie (`bartleby_session`).
Sessions are stateless except for an in-memory jti denylist used by logout.

**TODO (Workstream D):** users and sessions are held in an in-memory store
(`src/auth/store.ts`). When `D-001..D-002` (SQLite users table) land, swap the
store for a DB-backed implementation — the `SessionStore` interface is the
single seam to change.

## Google OAuth setup

1. Create or reuse a Google Cloud project at <https://console.cloud.google.com>.
2. APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Application type: **Web application**.
3. Authorized redirect URIs:
   - Dev: `http://localhost:3000/auth/google/callback`
   - Prod: `https://<your-domain>/auth/google/callback`
4. Copy the client ID and secret into `.env`.
5. While the OAuth consent screen is in "Testing" mode you must add each
   allowlisted email under "Test users".
