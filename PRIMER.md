# Bartleby — session primer

## Next session — 2026-10-24 weekend

**Goal.** Self-hosted real-time collaborative notes for a small friend group: a SvelteKit/ProseMirror
web editor and a Python Textual TUI as equal Yjs peers on a Node + Hocuspocus + SQLite server.

**Current state (main @ db710c1, 2026-10-23).** Every implementation task in `TASKS.md` (Phase 0, R, D, A, S, W,
T, C, M, I, X, O, Q) is `[x]`, including the six weekend tasks (R-008, S-014, W-029, T-027, T-028, Q-007),
which merged in PR #115. Only the launch checklist (L-001…L-010, minus L-006) is open, and all
of it needs Evan (credentials, DNS, friends, a soak). The app runs on Railway at
`bartleby-production-721b.up.railway.app` (`/health` → 200 on 2026-10-22). Since then Evan merged most of the
23 Dependabot PRs; of that set only #99 (node 22→26 image in `server/Dockerfile`) is still open. #88 (typescript
5→7 in `/server`) was closed, and #118 merged: Dependabot now holds typescript `>=7` in `/web` and `/server`
because typescript-eslint doesn't support TS 7 yet (see `.github/dependabot.yml`). A new batch of Dependabot
PRs, #119–#134, is open. No other open PRs. (BLOCKED.md's Dependabot line still says 23; that's for Evan to update.)
The `chore/adopt-blocker-standard` branch (ROCRLL rules in CLAUDE.md/agents.md + DECISIONS.md) still
exists on origin, unmerged. Leave it and Evan's local checkout alone.

**Baseline tests (measured 2026-10-22, before PR #115 and the Dependabot merges; re-measure before relying on counts):**
- `npm --prefix server test`: 435 passed, 1 skipped.
- `npm --prefix web test`: 24/24 then. It used to fail on a fresh clone until `svelte-kit sync` ran; R-008
  (PR #115) added a `pretest` sync, so it should now work from a clean `npm --prefix web ci`.
- `cd tui && uv run pytest`: 202 passed (~1m45s). Prints some app output to the terminal while it runs.
- Full suite: `make install && make test`. E2E (`make test-e2e`) spawns servers and Playwright, so run it only if a task needs it.

### Autonomous tasks, in order

**None left.** All six tasks this primer listed (R-008, S-014, W-029, T-027, T-028, Q-007) shipped in
PR #115 and are `[x]` in TASKS.md. What remains is the launch checklist (L-001…L-010 minus L-006) and the
items in `BLOCKED.md`, all of which need Evan. If a session starts here with nothing new from Evan, check
TASKS.md and BLOCKED.md for anything added since, and otherwise stop. If you do pick up new work, give it
the **next free ID** in its group (TASKS.md rule: never reuse IDs), one PR per task from `origin/main`, and
don't merge.

### House rules (from CLAUDE.md → agents.md)
- **Prime directive:** if anything is unclear, stop and ask. Unattended, that means you skip the
  task and write the question into `BLOCKED.md`.
- **TDD:** write the failing test first and watch it fail for the right reason. A task is done only when tests, lint and typecheck pass and everything is committed.
- Python: `uv` only (`uv run …`, `uv add` / `uv add --dev`; never hand-edit pyproject deps); pytest
  fixtures in `conftest.py`; ruff + ty; prek hooks. Use logging for debuggability. **Don't hide or wrap errors.**
- Node: `npm --prefix server|web run lint` and `run typecheck` must stay clean. No `any` / `@ts-ignore` / `eslint-disable` in `web/src`.
- The web↔server ProseMirror schema is mirrored (`web/src/lib/editor/schema.ts` ↔ server `derived/schema.ts`). If you change one, change the other.
- Add blockers to `BLOCKED.md` using the canonical format.

### Do NOT
- Deploy (Railway, `ops/deploy.sh`, `docker compose up` on any host) or change Railway variables.
- Merge any PR, Dependabot included, or push to `main`.
- Take TypeScript 7 in `/web` or `/server`, or remove the Dependabot hold from #118. It fails `npm install`
  until typescript-eslint supports it; lifting the hold is Evan's call.
- Work on L-001…L-010 (allowlist, Google OAuth, DNS/Caddy, Litestream bucket, prod happy-path, friend
  invites, soak, retro). These need Evan or real credentials.
- Flip the optional secrets in `server/src/config.ts` (O-008) to required. That's a deploy-time decision.
- Port the TUI from y-py to pycrdt to fix inline-mark round-tripping (T-005 caveat). It's a dependency and design call, so ask first.
- Touch the `chore/adopt-blocker-standard` branch or Evan's checkout at `~/Documents/portfolio/bartleby`.
- Use browser automation to verify anything. Use curl, logs and tests. Never read `.env` files (`ops/.env.example` is fine).
- Set `ALLOW_TEST_SIGN_IN` anywhere outside tests.
