# Bartleby — Launch Checklist

A working doc for taking Bartleby from "feature-complete in the repo" to "friends are using it at a real URL." All engineering work (Phase 0 + workstreams R/D/A/S/W/T/C/M/I/X/O/Q) is done; everything below is **operations, config, and rollout** — no code changes expected.

Mirror of the `L-*` tasks in [`TASKS.md`](../TASKS.md). Check items off here as you go.

---

## Part 0 — Run it locally (for demos / fooling around)

Not a launch gate — just how to get it up on your own machine. No Google OAuth needed: the server exposes a test-only `POST /auth/dev/sign-in` when `ALLOW_TEST_SIGN_IN=true`.

**Start the server** (WS on 1234, HTTP on 3000), from `server/`:

```sh
PORT=1234 HTTP_PORT=3000 BARTLEBY_BIND_ADDRESS=127.0.0.1 \
BARTLEBY_DB_PATH=../.dev-data/bartleby.db \
PUBLIC_BASE_URL=http://localhost:5173 \
SESSION_SECRET=dev-local-session-secret-change-me-0123456789 \
BARTLEBY_ALLOWED_EMAILS=appelew@gmail.com \
GOOGLE_CLIENT_ID=dev-placeholder-client-id \
GOOGLE_CLIENT_SECRET=dev-placeholder-client-secret \
ALLOW_TEST_SIGN_IN=true \
npm run dev
```

**Start the web client**, from `web/` (the `SESSION_SECRET` MUST match the server's — the web validates the session JWT locally):

```sh
BARTLEBY_HTTP_PORT=3000 \
SESSION_SECRET=dev-local-session-secret-change-me-0123456789 \
npm run dev
```

**Sign in** — there's no dev sign-in button in the UI (the `/login` page only knows how to redirect to Google), so open `http://localhost:5173`, then paste this into the browser devtools console:

```js
await fetch('/auth/dev/sign-in', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'appelew@gmail.com', displayName: 'Evan' }),
});
location.href = '/';
```

Notes persist to `.dev-data/bartleby.db` across restarts. Vite proxies `/auth`, `/notes`, `/search`, etc. to the server, so the browser sees a single origin.

> ⚠️ `ALLOW_TEST_SIGN_IN=true` and the placeholder Google creds are **dev-only**. Production must use real OAuth and must never set `ALLOW_TEST_SIGN_IN`.

---

## Part 1 — Provisioning & config

### L-001 · Allowlist populated
- [ ] Set `BARTLEBY_ALLOWED_EMAILS` (comma-separated) to every friend's Google email in the prod env (`ops/.env`).
- Missing/empty → the server rejects all sign-ins. A non-allowlisted email gets a 403 from the OAuth callback.

### L-002 · Google OAuth configured
- [ ] Create/confirm a Google Cloud OAuth 2.0 Client (Web application).
- [ ] Register the redirect URI for the prod subdomain: `https://<subdomain>/auth/google/callback`.
- [ ] Configure the consent screen (external, "testing" is fine for a fixed friend group — add each friend as a test user).
- [ ] Put `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `ops/.env`.
- [ ] Generate a real `SESSION_SECRET` (`openssl rand -hex 32`) and set it in `ops/.env`.

### Other required prod env (part of O-008 schema)
- [ ] `PUBLIC_BASE_URL=https://<subdomain>` (used for OAuth redirects + email deep links).
- [ ] `RESEND_API_KEY` (for @mention emails; unset → emails are logged, not sent).
- [ ] `LITESTREAM_BUCKET`, `LITESTREAM_ACCESS_KEY`, `LITESTREAM_SECRET_KEY` (see `ops/litestream.yml`).
- [ ] Confirm `ALLOW_TEST_SIGN_IN` is **NOT** set in prod.

---

## Part 2 — Deploy & infrastructure

### L-003 · DNS + TLS
- [ ] Point the subdomain's DNS A/AAAA record at the VPS IP.
- [ ] Bring up the stack (`ops/docker-compose.yml`: `bartleby` + `caddy` + `litestream`) via `ops/deploy.sh`.
- [ ] Confirm Caddy provisions a Let's Encrypt cert (`ops/Caddyfile`) — hit `https://<subdomain>` and check the padlock.
- [ ] Confirm the WebSocket upgrade works through Caddy (open a note in two tabs; edits sync).

### L-004 · Backups verified
- [ ] Confirm Litestream is replicating `bartleby.db` to the S3-compatible bucket (`ops/litestream.yml`).
- [ ] Do a **real restore test** on a separate machine per `ops/RESTORE.md` (O-006) and diff the restored DB content against prod.

### L-005 · Prod happy-path smoke
- [ ] As the operator, on prod: sign in → create a note → edit → comment → @mention a friend → check history/snapshots → export. All work end-to-end.

---

## Part 3 — Rollout

### L-006 · README TUI instructions
- [ ] Add TUI install instructions to the root README (`uv tool install` or equivalent) + the device-code first-run walkthrough (visit `/device`, enter the code).

### L-007 · Seed existing notes
- [ ] Import any pre-existing markdown notes via the web drag-and-drop import (W-025) or `POST /notes/import`.

### L-008 · Invite friends
- [ ] Email each friend: the URL, the TUI install one-liner, and "ping me if anything breaks."

### L-009 · One-week soak
- [ ] Operator + ≥2 friends use it daily for a week. Watch for the critical failures: data loss, repeated disconnects, auth failures.

### L-010 · Post-soak retro
- [ ] List sharp edges; file follow-up tasks in `TASKS.md` with new IDs.

---

## Quick reference — ops files

| File | Purpose |
| --- | --- |
| `ops/docker-compose.yml` | `bartleby` + `caddy` + `litestream` services |
| `ops/Caddyfile` | subdomain, auto-TLS, reverse proxy, WS upgrade |
| `ops/litestream.yml` | continuous SQLite replication to S3 |
| `ops/RESTORE.md` | step-by-step backup restore runbook |
| `ops/deploy.sh` | SSH → `git pull` → `docker compose up -d --build` (idempotent) |
| `server/src/config.ts` | the authoritative list of env vars + validation |
