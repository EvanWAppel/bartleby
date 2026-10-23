# Bartleby — session primer

## Next session — 2026-10-24 weekend

**Goal.** Self-hosted real-time collaborative notes for a small friend group: a SvelteKit/ProseMirror
web editor and a Python Textual TUI as equal Yjs peers on a Node + Hocuspocus + SQLite server.

**Current state (main @ 79cc74a).** Every implementation task in `TASKS.md` (Phase 0, R, D, A, S, W,
T, C, M, I, X, O, Q) is `[x]`. Only the launch checklist (L-001…L-010, minus L-006) is open, and all
of it needs Evan (credentials, DNS, friends, a soak). The app runs on Railway at
`bartleby-production-721b.up.railway.app` (`/health` → 200 on 2026-10-22). 23 Dependabot PRs are open
(#76–#99, #111). No other open PRs. Evan's local checkout sits on `chore/adopt-blocker-standard`
with an unmerged WIP commit (ROCRLL rules in CLAUDE.md/agents.md + DECISIONS.md). Leave it alone.

**Baseline tests (2026-10-22, fresh worktree):**
- `npm --prefix server test`: 435 passed, 1 skipped.
- `npm --prefix web test` **fails on a fresh clone** (`failed to resolve "extends":"./.svelte-kit/tsconfig.json"`).
  It passes (24/24) after `npx svelte-kit sync` in `web/`. Task R-008 below fixes this.
- `cd tui && uv run pytest`: 202 passed (~1m45s). Prints some app output to the terminal while it runs.
- Full suite: `make install && make test`. E2E (`make test-e2e`) spawns servers and Playwright, so run it only if a task needs it.

### Autonomous tasks, in order

There are no open build IDs, so each task below gets the **next free ID** in its group (TASKS.md rule:
never reuse IDs). Add the line to TASKS.md in the same PR that ships the work. One PR per task,
branched from `origin/main`. Open PRs. Do not merge them.

1. **R-008: make `npm --prefix web test` work on a fresh clone.** Add `svelte-kit sync` to the web
   test path, either as a `pretest` script or a vitest setup step. *Done:* in a clean worktree,
   `npm --prefix web ci && npm --prefix web test` passes with no manual sync. *Test:* that command plus `make test`.
2. **S-014: remove the stale in-memory auth store TODO.** `server/src/auth/store.ts` still says
   "TODO(D-001..D-002, D-011): replace with DB-backed…". PR #110 shipped `sqlite-user-store.ts`.
   Check what still imports the in-memory store (only tests, as of today). Then either delete the TODO
   and document the store as the test double, or move the tests onto the sqlite store. *Test:* `npm --prefix server test && npm --prefix server run lint && npm --prefix server run typecheck`.
3. **W-029: title blur-to-save (deferred from W-006).** Today only Enter commits the title. Write the
   failing Playwright or vitest test first (W-006 notes that Playwright's programmatic blur was the obstacle).
   If blur still can't be tested reliably, stop and record that. Do not ship it untested. *Test:* `npm --prefix web test`, plus the targeted e2e spec.
4. **T-027: line-number readout in the TUI presence status bar (deferred from T-018).** Spec shape:
   `● alice L42  ● you L42`. Publish the caret line through `set_local_awareness` and render peers' lines.
   *Test:* new case in `tui/tests/test_status_bar.py`; `uv run pytest tests/test_status_bar.py && uv run ruff check && uv run ty check`.
5. **T-028: snapshot inline preview in the history pane (deferred from T-015).** Decode the
   snapshot's Yjs state client-side with the existing renderer and show it in the pane. *Test:* a new
   case in `tui/tests/test_history_pane.py` with a fixture snapshot blob.
6. **Q-007: Dependabot triage report (read-only).** For each open Dependabot PR, record its CI status
   and whether it's patch/minor/major, and note the breaking-change risk for the majors (vitest 2→4,
   TS 6, checkout 7, node image). Put it in a markdown table **in the session's final summary only**. Do
   not commit it, comment on the PRs, or otherwise touch them. *Done:* summary handed to Evan.

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
- Work on L-001…L-010 (allowlist, Google OAuth, DNS/Caddy, Litestream bucket, prod happy-path, friend
  invites, soak, retro). These need Evan or real credentials.
- Flip the optional secrets in `server/src/config.ts` (O-008) to required. That's a deploy-time decision.
- Port the TUI from y-py to pycrdt to fix inline-mark round-tripping (T-005 caveat). It's a dependency and design call, so ask first.
- Touch the `chore/adopt-blocker-standard` branch or Evan's checkout at `~/Documents/portfolio/bartleby`.
- Use browser automation to verify anything. Use curl, logs and tests. Never read `.env` files (`ops/.env.example` is fine).
- Set `ALLOW_TEST_SIGN_IN` anywhere outside tests.
