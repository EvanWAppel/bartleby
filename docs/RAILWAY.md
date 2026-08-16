# Railway Deployment

Bartleby deploys to Railway as one service built from the repository-root
`Dockerfile`. The container runs three supervised processes behind one Caddy
gateway:

- Caddy listens on Railway's public `PORT` (normally `8080`).
- The SvelteKit web app listens on `127.0.0.1:3001`.
- The Node API and Hocuspocus collaboration server listen on
  `127.0.0.1:3000` and `127.0.0.1:1234`.

Caddy routes browser pages, REST requests, and `/collaboration` WebSockets to
the appropriate internal process. Railway only exposes the Caddy port.

## Railway service setup

1. Connect the repository and use its root directory. Railpack detects the
   root `Dockerfile`; no custom build or start command is required.
2. Mount a Railway volume at `/data` so SQLite survives deployments.
3. Set the public domain's target port to `8080`.
4. Use `/health` as the healthcheck path.
5. Add the variables below. Variable changes normally trigger a deployment,
   so add all required values before deploying.

### Required variables

| Variable                  | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`         | `https://bartleby-production-721b.up.railway.app`                            |
| `BARTLEBY_ALLOWED_EMAILS` | Comma-separated Google account emails allowed to sign in                     |
| `GOOGLE_CLIENT_ID`        | Google OAuth Web application client ID                                       |
| `GOOGLE_CLIENT_SECRET`    | Google OAuth client secret                                                   |
| `SESSION_SECRET`          | Random value of at least 32 characters; generate with `openssl rand -hex 32` |
| `BARTLEBY_DB_PATH`        | `/data/bartleby.db`                                                          |

Set `LOG_LEVEL=info` unless debugging requires a different supported level.
For mention email delivery, also set `RESEND_API_KEY` and optionally
`BARTLEBY_EMAIL_FROM`. Without `RESEND_API_KEY`, mention emails are logged but
not sent.

Never set `ALLOW_TEST_SIGN_IN` in Railway production. It exposes development
authentication and test administration routes.

## Google OAuth client

Create a Google OAuth client with application type **Web application**. Its
authorized redirect URI must match this value exactly:

```text
https://bartleby-production-721b.up.railway.app/auth/google/callback
```

Use this authorized JavaScript origin:

```text
https://bartleby-production-721b.up.railway.app
```

The app requests the standard `openid`, `email`, and `profile` scopes. During
Google's **Testing** publishing status, add every allowed account as a test
user as well as listing it in `BARTLEBY_ALLOWED_EMAILS`.

Store the client ID and secret in Railway variables. Do not commit them or
place them in a PR, issue, or chat message.

## Verification

After deployment, check the public gateway and then complete a real sign-in:

```sh
curl --fail --show-error \
  https://bartleby-production-721b.up.railway.app/health
```

The response should be `{"status":"ok","db":"ok"}`. Then open `/login`,
sign in with an allowlisted Google account, create a note, and confirm edits
persist after a page reload.
