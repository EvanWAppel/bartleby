# BLOCKED — what I need from Evan

Deploy/launch stack — see `docs/LAUNCH-CHECKLIST.md`. Most of these are account/credential setup only you can do.

- [ ] 🔴 **VPS + domain/DNS for production** — rent a VPS (Hetzner, Fly, etc.), point a domain (or subdomain you own) at it, and let Caddy provision TLS via Let's Encrypt; deploy via Docker Compose. The hostname is also needed for the Google OAuth redirect URI. Single-service Railway alternative in `docs/RAILWAY.md`. Only you can do the infra/registrar step.
- [ ] 🔴 **Google OAuth credentials** — create a Google Cloud Console project, make OAuth 2.0 Web Application credentials, set the redirect URI, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the deploy env. See LAUNCH-CHECKLIST Part 1.
- [ ] 🔴 **Resend email API key** (@mention notifications) — sign up at Resend, create a key, set `RESEND_API_KEY` in the deploy env. Free tier covers mention digests.
- [ ] 🔴 **S3-compatible bucket for Litestream backups** — create a Backblaze B2 or Cloudflare R2 bucket + keys; set `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `LITESTREAM_BUCKET`, and the replica path in `ops/litestream.yml`. See LAUNCH-CHECKLIST Part 2.
- [ ] 🔴 **Allowlist the launch group** — set `BARTLEBY_ALLOWED_EMAILS` (comma-separated) to the final 3–6 friends. This is the access-control gate.
