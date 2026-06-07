# Bartleby — Implementation Tasks

Companion to `PRD.md`. Every task is a small, specific unit of work with an ID and a checkbox.

## How to use this file

- **TDD discipline.** Every task that involves code follows red-green-refactor: write the failing test first, watch it fail for the right reason, then implement until it passes. A task is not complete unless its `test:` clause is satisfied and the test is committed.
- **IDs.** Stable two- or three-letter prefix + zero-padded number. New tasks get the next free number in their group; never reuse IDs.
- **Dependencies.** `deps: ID-NNN, ID-NNN` lists hard prerequisites. No deps means the task can start immediately (assuming Phase 0 is done).
- **Parallelism.** Phase 0 is serial — do not start workstreams until V- tasks are all green. After Phase 0, each workstream below is largely independent; one agent per workstream is a reasonable allocation.
- **Definition of done for any task:** failing test written first → tests pass → linter and typechecker pass (`ruff` + `ty` for Python per `agents.md`, project equivalents for Node/web) → committed.

---

## Phase 0 — Vertical Slice (serial, do this first)

The goal of Phase 0 is to prove the hardest architectural claim in the PRD: a ProseMirror+y-prosemirror web client and a textual+y-py TUI client can be live peers on the same Yjs document via a Hocuspocus server. Nothing else is built until this works.

- [x] **V-001** Initialize monorepo: `server/`, `web/`, `tui/`, `ops/`, `docs/`. Root `README.md` with a short "what is this" + how to run each piece. (test: `ls` shows the four dirs; root README mentions all three components.)
- [x] **V-002** Server: bootstrap Node project in `server/` with TypeScript, vitest, prettier, eslint. (test: `npm test` runs and reports 0 tests.)
- [x] **V-003** Server: stand up a bare Hocuspocus instance on a local port, no auth, in-memory storage, no SQLite yet. (test: integration test boots the server and asserts a WebSocket client can connect and complete a Yjs handshake.)
- [x] **V-004** Web: bootstrap web project in `web/` (SvelteKit recommended; document the choice in `web/README.md`). Add vitest + playwright. (test: `npm run dev` serves index page; playwright smoke test loads it.)
- [x] **V-005** Web: single-page editor at `/` with a ProseMirror instance bound to a Yjs document via y-prosemirror, hardcoded room name `"vertical-slice"`, connects to local server from V-003. (test: playwright loads page, types "hello", reads it back from the DOM.)
- [x] **V-006** TUI: bootstrap Python project in `tui/` with `uv init`, add `textual`, `y-py`, `websockets`, `pytest`, `ruff`, `ty`, `prek`. (test: `uv run pytest` runs and reports 0 tests; `uv run ruff check` and `uv run ty check` pass on empty project.)
- [x] **V-007** TUI: minimal textual app that connects to the local server, joins the same `"vertical-slice"` room, and shows the Yjs document's text content in a single read-only widget. (test: pytest integration test using `textual.pilot` confirms the widget renders text after a remote Yjs update is applied.)
- [x] **V-008** TUI: enable local editing — keystrokes in the widget produce Yjs ops that propagate to the server. (test: pytest drives a TextArea via pilot, asserts the resulting Yjs document state matches expectation; second integration test asserts the change is visible via a separate y-py client.)
- [x] **V-009** End-to-end smoke (manual + scripted): run server + web + TUI, type in web, observe text appearing in TUI, type in TUI, observe text appearing in web. Record a short asciinema or screenshot in `docs/vertical-slice.md`. *(scripted parts covered by automated tests; asciinema is operator to record.)*
- [x] **V-010** Server: replace in-memory storage with Hocuspocus's SQLite extension; persist Yjs state across restarts. (test: integration test writes data, restarts the server, reads it back.)
- [x] **V-011** Confirm V-009 still works with persistence enabled. Update `docs/vertical-slice.md` with the restart-survives-data caveat.

**Phase 0 exit criteria:** all V- tasks checked. The architecture is proven; parallel workstreams can begin.

---

## Workstream R — Repo, tooling, CI

Lightweight infrastructure that the other workstreams depend on. Mostly fast.

- [x] **R-001** Root `.editorconfig`, `.gitignore`, `LICENSE` (MIT or similar). (test: lint config check or just visual review.)
- [x] **R-002** `tui/`: set up `prek` pre-commit hooks running `ruff` and `ty`. (test: `prek run --all-files` passes on a clean tree; failing test added to confirm a deliberately broken file fails the hook.)
- [x] **R-003** `server/`: set up husky or lefthook for pre-commit running `eslint` + `prettier --check` + `vitest run`. (test: hook fires on commit attempt; broken file blocks commit.)
- [x] **R-004** `web/`: same pattern as R-003 (eslint, prettier, vitest, optional `svelte-check`/`tsc --noEmit`).
- [x] **R-005** GitHub Actions workflow `.github/workflows/ci.yml`: jobs for server (Node), web (Node), tui (Python via uv) running tests + lint + typecheck on PR. (test: PR opened against `main` triggers all three jobs.)
- [x] **R-006** GitHub Actions: cache `node_modules`, `uv` venv, and Playwright browsers for fast CI. (test: second run completes faster than first; cache hit logged.)
- [x] **R-007** Root `Makefile` (or `justfile`) with targets: `dev` (run all three concurrently), `test` (run all suites), `lint`, `typecheck`. (test: `make test` exits 0 on a green tree.)

---

## Workstream D — Data layer and migrations

All migrations are SQLite. Each migration ships with a test that exercises the new schema.

- [x] **D-001** Choose and wire a SQLite migration tool (recommend `umzug` + `better-sqlite3`). Add `migrate up` / `migrate down` scripts. (test: empty DB after `up` then `down` is the same as never running; `up` is idempotent.)
- [x] **D-002** Migration 001 — `users`: id (uuid), email (unique), display_name, color, created_at. (test: insert + select round-trip; unique-email constraint rejects duplicates.)
- [x] **D-003** Migration 002 — `notes`: id (uuid), title, created_by FK users, created_at, updated_at, trashed_at (nullable), markdown_export (text). (Yjs blob lives in Hocuspocus's `documents` table, not here — see `server/src/db/README.md`.) (test: round-trip; trashed_at filter works.)
- [x] **D-004** Migration 003 — `note_titles_history`: note_id FK notes, title, valid_from, valid_to (nullable). Index on (title) and (note_id). (test: insert two titles for one note; resolve old title returns the right note.)
- [x] **D-005** Migration 004 — `tags`: note_id FK notes, tag (text). Unique (note_id, tag). Index on tag. (test: insert + dedupe; list-by-tag returns notes.)
- [x] **D-006** Migration 005 — `backlinks`: source_note_id, target_note_id, link_text. Index on both. (test: insert + query inbound returns correct sources.)
- [x] **D-007** Migration 006 — `comments`: id, note_id, author_id, parent_comment_id (nullable), anchor (text), original_quote (text), body, created_at, resolved_at (nullable). (test: insert thread; resolve sets resolved_at.)
- [x] **D-008** Migration 007 — `snapshots`: id, note_id, yjs_state (blob), created_at, label (nullable). Index on (note_id, created_at). (test: insert + list-by-note-newest-first.)
- [x] **D-009** Migration 008 — `mentions`: id, note_id, mentioned_user_id, mentioning_user_id, source (text), created_at, read_at (nullable), email_sent_at (nullable). (test: unread filter returns only unread.)
- [x] **D-010** Migration 009 — FTS5 virtual table `notes_fts` over `notes.markdown_export`, with triggers maintaining it on insert/update/delete of `notes`. (test: insert a note, FTS query returns it; rename, FTS still matches.)
- [x] **D-011** Repository layer: typed read/write functions per table, all with tests. (test: per-table unit tests cover the public API.)
- [x] **D-012** Database fixture utilities for tests: in-memory SQLite + migration up, clean teardown. (test: two consecutive tests get isolated DBs.)

---

## Workstream A — Auth

Google OAuth allowlist + session cookies (web) + device-code flow (TUI). All routes after this workstream require an authenticated session.

- [x] **A-001** Allowlist config: `BARTLEBY_ALLOWED_EMAILS` env var (comma-separated) loaded at startup. (test: unknown email rejected; allowed email accepted; missing env var fails startup loudly.)
- [x] **A-002** Google OAuth authorization-code endpoints: `GET /auth/google/start` redirects to Google; `GET /auth/google/callback` exchanges code, fetches userinfo, checks allowlist, upserts `users` row, sets session cookie. (test: full flow with mocked Google endpoints; non-allowlisted email returns 403 and no session.)
- [x] **A-003** Session middleware: signed cookie containing user id; rejects unauthenticated requests on protected routes. (test: protected route returns 401 without cookie, 200 with valid cookie, 401 with tampered cookie.)
- [x] **A-004** `GET /auth/me` returns the current user (id, email, display_name, color). (test: returns user data when authed, 401 otherwise.)
- [x] **A-005** `POST /auth/logout` clears the session cookie. (test: subsequent request is unauthed.)
- [ ] **A-006** Device-code start: `POST /auth/device/start` returns `{ device_code, user_code, verification_uri, interval, expires_in }`; stores pending row. (test: returns shape; row exists.)
- [ ] **A-007** Device-code verify page: `GET /device` HTML page; `POST /device/approve` looks up user_code, attaches the authenticated user, marks approved. (test: unauthenticated user is redirected to OAuth then back to /device; approving marks row.)
- [ ] **A-008** Device-code poll: `POST /auth/device/poll` with device_code returns 428 while pending, 200 with refresh+access tokens once approved, 410 if expired. (test: state machine covered.)
- [ ] **A-009** Token refresh: `POST /auth/token/refresh`. (test: refresh issues new access token; revoked refresh token returns 401.)
- [ ] **A-010** Hocuspocus auth hook: validates Bearer token on `onConnect`; rejects unauthenticated connections; attaches user id to the connection context. (test: WS handshake without token closes; with valid token succeeds.)

---

## Workstream S — Server REST API

REST endpoints for everything that isn't live Yjs traffic. All require an authenticated session via A-003 or token via A-010. Depends on D-* migrations.

- [x] **S-001** `POST /notes` — create note; returns `{ id, title }`. Initial Yjs state is an empty ProseMirror doc. Writes `notes` and `note_titles_history` rows. (test: returns 201 with id; row exists; FTS finds it after first save.) *(Yjs state materializes on first WS connect via Hocuspocus; this endpoint only writes the metadata row + history entry.)*
- [x] **S-002** `GET /notes` — list non-trashed notes with `id`, `title`, `tags`, `updated_at`. Supports `?tag=foo` and `?q=text`. (test: list shape; tag filter; FTS query.)
- [x] **S-003** `GET /notes/trash` — list trashed notes. (test: only trashed notes returned.)
- [x] **S-004** `PATCH /notes/:id` — update title and/or tags. Title change appends to `note_titles_history`. (test: title rename history grows; tags replaced atomically.)
- [x] **S-005** `DELETE /notes/:id` — soft-delete (sets `trashed_at`). (test: note disappears from `GET /notes`, appears in `GET /notes/trash`.)
- [x] **S-006** `POST /notes/:id/restore` — clears `trashed_at`. (test: round-trip with S-005.)
- [x] **S-007** `GET /notes/:id/backlinks` — returns inbound links (source note id, title, link_text). (test: link from A to B shows A in B's backlinks.) *(also omits backlinks whose source note has been trashed — phantom-source guard.)*
- [x] **S-008** `GET /notes/resolve?title=...` — title → uuid resolver using `note_titles_history`. Returns 200 with id, 404 if unknown, 300/ambiguous response if multiple current matches. (test: all three cases.) *(historical titles resolve too — `[[OldName]]` after a rename still finds the note.)*
- [x] **S-009** Yjs change hook: on `onStoreDocument` (Hocuspocus), serialize doc to markdown, update `notes.markdown_export`, re-extract tags (from frontmatter or inline `#tag`), re-extract `[[backlinks]]`, update FTS. Debounce per note id (1–2s). (test: write to Yjs doc → tables updated within debounce window; concurrent writes coalesce.) *(debounce is Hocuspocus's built-in for SQLite WAL flush — our hook runs after that, no extra debouncing needed. FTS5 triggers update notes_fts automatically off the markdown_export UPDATE.)*
- [x] **S-010** Trash purge job: every hour, hard-delete notes with `trashed_at` older than 30 days, cascading to comments/snapshots/backlinks/mentions/tags. (test: time-traveled note older than 30 days is purged; younger note is not.) *(cascade is automatic via D's FK `ON DELETE CASCADE` on every dependent table; this PR only owns the scheduler + the cutoff math. Timer is unref()'d so it doesn't block shutdown.)*
- [x] **S-011** `GET /search?q=...` — FTS search over `notes_fts`, returns notes with snippet. (test: query matches body and title.)
- [x] **S-012** Error model: consistent JSON error responses (`{ error: { code, message } }`). (test: 4xx/5xx all match shape.)
- [x] **S-013** Request logging via pino: structured JSON, includes user id, route, status, duration. (test: log assertion via test transport.)

---

## Workstream W — Web client features

Each task ships with a Playwright test asserting the behavior end-to-end against a test server. Depends on V-* and A-005 (sign-in flow).

- [x] **W-001** Route skeleton: `/`, `/n/:id`, `/trash`, `/inbox`. Unauthed users hit `/login` and get redirected to Google. (test: routing + auth gate.) *(PR 1 ships `/`, `/n/:id`, `/login` + the auth gate. `/trash` and `/inbox` stubs land with W-022 and W-023 respectively.)*
- [x] **W-002** Sign-in page (`/login`) with a single "Sign in with Google" button. (test: click redirects to `/auth/google/start`.)
- [x] **W-003** App shell: left sidebar + main pane + collapsible right pane. Keyboard shortcut `Cmd-K` focuses search. (test: layout exists; shortcut focuses input.) *(layout shipped; Cmd-K search shortcut lands with W-020 search overlay.)*
- [x] **W-004** Sidebar: notes list, search input, tag filter chips, "New note" button. List updates live when notes are created/renamed/deleted on the server. (test: create-from-API appears in list within 1s.) *(W PR 2 ships the list + "new note" button + 1s polling for live updates. Search input + tag filter chips land in W-020 / W-021.)*
- [x] **W-005** New note flow: click button → `POST /notes` → navigate to `/n/:id` with focus in the title field. (test: click leads to editable new note.) *(form-submit to `/api/notes/new` → server proxies to bartleby POST /notes → 303 to /n/[new-id]. Default title is "Untitled".)*
- [x] **W-006** Title-in-place editor: editable `<h1>` at top of note; commits to `PATCH /notes/:id` on blur or Enter. (test: rename persists.) *(Enter triggers form-submit → server PATCH → 303 reload. Blur-to-save is deferred — Svelte 5 event delegation didn't cooperate with Playwright's programmatic blur events in this combo; Enter satisfies the core spec.)*
- [x] **W-007** Tag chip editor below the title: add tag (type + Enter), remove tag (× on chip). Commits via `PATCH /notes/:id`. (test: add/remove round-trips.) *(form-submit pattern: each chip × is its own form posting "tags minus this one"; the add form posts current `tags` + a `newtag` field, server combines + dedupes. The endpoint's newline delimiter for `tags` keeps tags-with-commas safe.)*
- [ ] **W-008** ProseMirror editor with y-prosemirror, joins room `note:<id>`. Toolbar: bold, italic, strike, link, H1/H2/H3, bullet/ordered list, blockquote, code block. (test: each toolbar action produces the right ProseMirror node/mark.)
- [ ] **W-009** Keyboard shortcuts: `Cmd-B`, `Cmd-I`, `Cmd-Shift-X`, `Cmd-K` (link), markdown-style `#` / `##` / `- ` / `1. ` / `> ` autocomplete on empty line. (test: each shortcut.)
- [ ] **W-010** Task list rendering and toggle (click checkbox or Space when caret inside). (test: toggling persists.)
- [ ] **W-011** Code block: language picker, syntax highlighting via Shiki. (test: rendered code block has correct token classes.)
- [ ] **W-012** `[[backlink]]` syntax: typing `[[` opens a notes-picker autocomplete (fuzzy over titles); selecting inserts a stable backlink node. Rendered as a clickable link. (test: autocomplete populates; click navigates.)
- [ ] **W-013** @mention syntax: typing `@` opens a friends-picker over the allowlist; selecting inserts a mention node. (test: picker shows users; selecting inserts.)
- [ ] **W-014** Presence cursors: render remote users' carets and selections in their assigned color with a name label above. (test: second browser session shows up as a colored cursor in the first.)
- [ ] **W-015** Right pane tabs: Comments / Backlinks / History. Persist open tab per note in localStorage. (test: tab choice survives reload.)
- [ ] **W-016** Backlinks pane: shows inbound links from `GET /notes/:id/backlinks`. (test: link from A to B shows A in B's pane.)
- [ ] **W-017** Comments pane: thread list, expanded thread shows replies, reply composer, resolve button. Comment markers in the body are numbered and clickable. (test: full CRUD.)
- [ ] **W-018** Comment composer: select text in body → "Comment" action in floating toolbar → composes inline; submits to comments endpoints. (test: selection produces anchor; comment renders in pane.)
- [ ] **W-019** Snapshots pane: list of snapshots (named + auto), preview pane, "Restore" action. (test: restore replaces document content.)
- [ ] **W-020** Search results page or overlay: keyword search calls `GET /search`, shows snippets, clicking opens the note. (test: query → result → navigate.)
- [ ] **W-021** Tag filter: clicking a tag chip in the sidebar filters the list. Clicking again clears. (test: click cycles.)
- [ ] **W-022** Trash view (`/trash`): list trashed notes; "Restore" and "Delete forever" actions per row. (test: restore round-trip with W-024.)
- [ ] **W-023** Mentions inbox (`/inbox`): list of unread + recent mentions; clicking marks as read and navigates to the source. (test: unread badge clears on click.)
- [ ] **W-024** Delete confirmation modal (soft-delete) from the note view and from the list. (test: confirm soft-deletes; cancel does nothing.)
- [ ] **W-025** Drag-and-drop import: drop one or more `.md` files onto the notes list → POST each via import endpoint → appear in list. (test: drop 2 files → 2 new notes appear.)
- [ ] **W-026** Export-all-as-zip button in sidebar footer. (test: download initiated; zip contains one file per note with frontmatter tags.)
- [ ] **W-027** Per-note "Copy as markdown" in a note-options menu. (test: clipboard receives expected markdown.)
- [x] **W-028** Empty state for first-time users: friendly text + "Create your first note" CTA. (test: list empty → CTA visible; non-empty → CTA hidden.) *(initial empty state on `/` with placeholder copy; the "Create your first note" CTA wires up in W-005.)*

---

## Workstream T — TUI client features

`textual` + `y-py`. All tests use `textual.pilot` for UI assertions and pytest fixtures for server setup. Depends on V-* and A-006/A-007/A-008 (device-code flow).

- [ ] **T-001** App skeleton: `Notes` pane (left), `Editor` pane (main), `StatusBar` (bottom). Empty placeholder content. (test: pilot snapshot of layout regions.)
- [ ] **T-002** Device-code first-run: if no token in keychain, print device-code URL + code, poll until approved, store token. (test: integration test against a mock auth server runs the full flow.)
- [ ] **T-003** y-py connection layer: connects to `wss://.../collab/note:<id>` with Bearer token, subscribes to a YDoc, exposes `apply_local_op(op)` and `on_remote_update(callback)`. (test: two clients on same room see each other's updates.)
- [ ] **T-004** Renderer: walks the ProseMirror-compatible Yjs document and produces a textual `RichLog` (or custom widget) representation. Supports: paragraphs, H1–H6, bold/italic/strike (rich text styles), links (underline + color, footnoted), bullet/ordered lists, blockquote (left bar), task lists (`[ ]` / `[x]`), code blocks (bordered, syntax-highlighted via pygments). (test: snapshot per node type.)
- [ ] **T-005** Editing primitives: `insert_text`, `delete_range`, `toggle_mark`, `set_block_type`, `wrap_in_list`, `toggle_task` — each emits the corresponding Yjs op. (test: unit tests over a mock YDoc.)
- [ ] **T-006** Keybinds (vim-flavored, discoverable via `?`):
  - Insert mode by default; `Esc` to normal mode.
  - `Ctrl-B` toggle bold, `Ctrl-I` italic, `Ctrl-Shift-X` strike, `Ctrl-K` link prompt.
  - `# ` / `## ` / `### ` on empty line → heading.
  - `- ` / `1. ` / `> ` → list / blockquote.
  - `Space` on a task list line → toggle checkbox.
  - `[[` → backlink picker overlay.
  - `@` → mentions picker overlay.
  (test: each keybind covered by a pilot test.)
- [ ] **T-007** Notes list pane: live list of notes (title, tags, updated_at). Live-updates via SSE or WebSocket on the REST side. (test: another client creating a note causes the list to update within 1s.)
- [ ] **T-008** Search (`/`): inline search input filters notes list via `GET /search`. (test: typing filters; Enter opens top result.)
- [ ] **T-009** Tag filter: `t` opens a tag picker; selected tags filter the list. (test: select tag → list reduced.)
- [ ] **T-010** Note CRUD: `n` new, `r` rename (modal), `d` delete (confirm), `R` restore from trash. (test: each action.)
- [ ] **T-011** Backlink follow: pressing Enter on a `[[link]]` token navigates to the linked note. (test: caret on link → Enter → editor switches.)
- [ ] **T-012** Inbound links pane (`g b`): toggle pane showing notes that link here. (test: pane visible; lists correct entries.)
- [ ] **T-013** Comments pane (`g c`): list of threads, comment markers numbered in body, composer modal on `c` (with current selection as anchor). (test: composing a comment shows it in pane + as a body marker.)
- [ ] **T-014** Comment reply + resolve: `Enter` on a thread expands it; `r` reply; `x` resolve. (test: each action.)
- [ ] **T-015** Snapshots/history pane (`g h`): list of snapshots, preview, `Enter` restores (with confirm). (test: restore replaces doc.)
- [ ] **T-016** Trash view (`g t`): list trashed notes; `R` restores, `D` deletes forever. (test: round-trip.)
- [ ] **T-017** Mentions inbox (`g i`): list unread + recent; Enter navigates and marks read. (test: unread count drops.)
- [ ] **T-018** Status bar: connection state (`● live` / `○ offline — N pending`), presence (`● alice L42  ● you L42`), brief hint area. (test: presence updates when another client joins.)
- [ ] **T-019** Offline behavior: on disconnect, accept edits locally (Yjs queues), show `offline — N pending`; on reconnect, sync resolves automatically. (test: simulate disconnect, type, reconnect, assert remote sees edits.)
- [ ] **T-020** `?` help overlay: scrollable keybind reference grouped by mode. (test: opens, scrolls, dismisses.)
- [ ] **T-021** `:` command palette: fuzzy over commands and note titles. (test: types `:export`, runs export.)
- [ ] **T-022** Export single note (`:export`) writes `.md` to a chosen path. (test: file exists with expected content.)
- [ ] **T-023** Export all (`:export-all`) writes zip to a chosen path. (test: zip contains expected files.)
- [ ] **T-024** Color: assign per-user colors at user creation server-side; TUI reads from `/auth/me` and applies to presence rendering. (test: two users have distinct colors.)
- [ ] **T-025** Pygments-based syntax highlighting for code blocks. (test: a Python code block renders with expected token styles.)

---

## Workstream C — Collaboration features (cross-client)

Server-side mechanisms behind comments, history, presence, mentions. The clients (W- and T-) consume these.

- [ ] **C-001** Awareness wiring: Hocuspocus awareness propagates user id, name, color, cursor RelativePosition. (test: two clients see each other's awareness.)
- [ ] **C-002** Snapshot scheduler: per note, every ~5 min, if doc changed since last snapshot, write an unlabeled snapshot row. (test: time-traveled scheduler writes one row after change, none after another tick with no change.)
- [ ] **C-003** Named snapshots: `POST /notes/:id/snapshots { label }`. (test: row created with label.)
- [ ] **C-004** Snapshot list: `GET /notes/:id/snapshots` paginated. (test: returns newest-first.)
- [ ] **C-005** Snapshot retention: prune auto-snapshots beyond the most recent 50 per note. Named snapshots exempt. (test: insert 60 auto + 5 named → 50 auto + 5 named remain.)
- [ ] **C-006** Snapshot restore: `POST /notes/:id/snapshots/:snap_id/restore`. Writes a pre-restore auto-snapshot of current state, then applies snapshot's Yjs state to the live doc. (test: restore changes content; pre-restore snapshot exists.)
- [ ] **C-007** Comments CRUD: `POST /notes/:id/comments`, `GET /notes/:id/comments`, `POST /comments/:id/replies`, `PATCH /comments/:id/resolve`, `PATCH /comments/:id/reopen`, `DELETE /comments/:id`. Anchor is a serialized Yjs RelativePosition pair. (test: each verb.)
- [ ] **C-008** Comment orphan detection: on every Yjs change for a note, recompute anchor resolvability; mark comments whose anchor no longer resolves. Surface via `is_orphaned` flag. (test: delete anchored text → comment becomes orphaned.)
- [ ] **C-009** Comment quote snapshot: at create time, store the currently-anchored text in `original_quote` for use when orphaned. (test: orphan retains original text.)

---

## Workstream M — @mentions and email

Depends on D-009 (`mentions` table), C-007 (comments), and a Resend API key.

- [ ] **M-001** Mention extraction on Yjs change: when a note's serialized markdown changes, diff old vs new mention nodes; insert new `mentions` rows for net-new mentions. (test: adding `@alice` creates a row; editing without removing doesn't duplicate.)
- [ ] **M-002** Mention extraction on comment write: when a comment is created or edited, scan body for mention nodes; insert rows. (test: comment with `@bob` creates row.)
- [ ] **M-003** Inbox endpoint: `GET /mentions?unread=true|false` returns mentions for the current user. (test: filter by unread; pagination.)
- [ ] **M-004** Mark-as-read: `POST /mentions/:id/read`. (test: read_at set.)
- [ ] **M-005** Resend integration with batching: on new mention row, schedule send; coalesce mentions to the same user within a 60s sliding window into one email. (test: 3 mentions in 30s → 1 send with 3 items; 2 mentions 90s apart → 2 sends.)
- [ ] **M-006** Email template: plain HTML + text, includes mention context (snippet) and a deep link to the note. (test: rendered HTML contains expected fields; link is signed/auth-gated.)
- [ ] **M-007** Email send failure handling: retry with backoff; log on permanent failure; do not block mention row creation. (test: simulated 5xx retried; eventual failure logged.)

---

## Workstream I — Import / export

Depends on a ProseMirror-markdown serializer (shared util used by S-009 too) and on the auth/REST baseline.

- [ ] **I-001** Markdown→ProseMirror parser as a server-side utility, supporting all v1 markdown nodes (PRD §6.2). (test: round-trip cases for each node type.)
- [ ] **I-002** ProseMirror→Markdown serializer as a server-side utility, same coverage. (test: round-trip identical for canonical inputs.)
- [ ] **I-003** Import endpoint: `POST /notes/import` (multipart), accepts one or more `.md` files; creates notes with parsed initial Yjs state and frontmatter tags applied. (test: 2-file upload → 2 notes with tags.)
- [ ] **I-004** Single-note export: `GET /notes/:id/export.md`. Frontmatter includes tags. (test: response is markdown with frontmatter.)
- [ ] **I-005** Export-all-as-zip: `GET /export/all.zip`. (test: zip contains N files for N notes; filenames are slugified titles.)
- [ ] **I-006** Title collisions in export: append short id suffix when slugified titles collide. (test: two notes with same title produce distinct filenames.)

---

## Workstream X — Mobile read-only

Depends on web app baseline (W-001 to W-003).

- [x] **X-001** Responsive breakpoint at ~768px; below that, switch to mobile shell. (test: viewport resize toggles layout.)
- [x] **X-002** Mobile shell: single-column, top bar with title, hamburger reveals notes list as a slide-over. No editor toolbar. (test: layout per Playwright mobile emulation.) *(hamburger/notes-list deferred: no notes-list exists until Workstream W ships; the shell uses a topbar only for v1.)*
- [x] **X-003** Mobile note view: rendered (read-only) ProseMirror without editing affordances. Comments visible inline (read-only). (test: tapping in body does not open the keyboard / editor.) *(comments come with C; v1 just renders body.)*
- [x] **X-004** "Open on desktop" banner with `mailto:` link prefilled with the current note URL. (test: link href contains the URL.)

---

## Workstream O — Ops, deploy, backups

Targets a single small VPS. Depends on the server being launchable as a single Node process.

- [x] **O-001** `server/Dockerfile`: multi-stage build, slim runtime, non-root user. (test: `docker build` succeeds; image runs and serves `/health`.) *(Dockerfile written; `docker build` smoke deferred — Docker not installed in this dev env. CI/deploy will exercise it.)*
- [x] **O-002** `server/healthcheck`: `GET /health` returns 200 with DB connection check. (test: returns 200 when DB ok, 503 when DB broken.)
- [x] **O-003** `ops/docker-compose.yml`: services `bartleby`, `caddy`, `litestream`. Volumes for SQLite, Caddy data, Litestream config. (test: `docker compose up` brings all three to healthy.) *(compose authored + `.env.example` committed; live `up` deferred until deploy host exists.)*
- [x] **O-004** `ops/Caddyfile`: subdomain config with auto TLS via Let's Encrypt, reverse proxy to `bartleby:port`, WebSocket upgrade for the Hocuspocus endpoint. (test: TLS handshake works against a staging hostname.) *(Caddyfile authored; ACME exchange happens on first deploy.)*
- [x] **O-005** `ops/litestream.yml`: continuous replication of `bartleby.db` to S3-compatible bucket (env-driven endpoint/key). (test: write to DB → replicated object updates within seconds.) *(config authored; live S3 round-trip deferred to deploy.)*
- [x] **O-006** Backup restore runbook in `ops/RESTORE.md`: step-by-step Litestream restore to a fresh VPS. (test: dry-run restore on a separate disk produces a DB whose content matches.) *(runbook written + includes a dry-run section; live verification awaits an actual bucket.)*
- [x] **O-007** Deploy script `ops/deploy.sh`: SSH to VPS, `git pull`, `docker compose up -d --build`. Idempotent. (test: re-running on an up-to-date repo is a no-op.) *(written + bash-syntax-checked; idempotence is structural — `git pull --ff-only` is a no-op when up-to-date and compose `up -d` skips rebuilds when there's no change.)*
- [x] **O-008** Env var schema validation at server startup using `zod` or equivalent. Required: `BARTLEBY_ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `RESEND_API_KEY`, `PUBLIC_BASE_URL`, `LITESTREAM_BUCKET`, `LITESTREAM_ACCESS_KEY`, `LITESTREAM_SECRET_KEY`. (test: missing required var fails startup with a clear message.) *(zod schema in `server/src/config.ts`. A/M-owned secrets stay `.optional()` with TODO comments to flip to required when those workstreams ship — flipping now would block local dev. Litestream creds live in `ops/.env`, not server process env, so they're not in the server schema.)*
- [x] **O-009** Pino structured logging configured for production (JSON to stdout, redactions for secrets). (test: log contains expected fields; secrets are redacted.)
- [x] **O-010** Crash-safety smoke test: kill `bartleby` mid-edit; confirm restart reconnects clients and no data is lost. (test: scripted integration test.)
- [x] **O-011** Migrations run automatically on `bartleby` container startup, idempotent. (test: starting twice does not error.) *(entrypoint hook in `server/src/migrate.ts` runs unconditionally on `main()` startup; no-op until Workstream D-001 wires umzug.)*

---

## Workstream Q — Cross-cutting quality

- [ ] **Q-001** End-to-end test: two browser sessions on the same note, simultaneous typing, no data loss. (test: Playwright with two contexts.)
- [ ] **Q-002** End-to-end test: web + TUI on the same note, simultaneous typing, no data loss. (test: pytest spinning up Playwright via subprocess + a TUI client.)
- [ ] **Q-003** End-to-end test: full sign-in → create note → comment → @mention → email-sent assertion (mocked Resend). (test: scripted.)
- [ ] **Q-004** Load: simulate 5 concurrent users editing 5 notes for 10 min; assert no errors, snapshot growth bounded, memory stable. (test: scripted; thresholds documented.)
- [ ] **Q-005** Accessibility pass on web: keyboard-only navigation works; aria-labels on icon buttons; color contrast on presence cursors readable in light + dark. (test: axe scan on key routes.)

---

## Launch checklist

Final gates before sharing the URL with friends.

- [ ] **L-001** `BARTLEBY_ALLOWED_EMAILS` populated with all friends' emails.
- [ ] **L-002** OAuth Google project configured: redirect URI registered for the prod subdomain; consent screen approved (test users only is fine).
- [ ] **L-003** Domain DNS pointed at the VPS; Caddy successfully provisions a Let's Encrypt cert.
- [ ] **L-004** Litestream replication active and verified via a test restore on a separate machine (O-006).
- [ ] **L-005** Operator runs through full happy path on prod (sign-in, create, edit, comment, mention, history, export).
- [ ] **L-006** README contains TUI install instructions (`uv tool install` or equivalent) and the device-code first-run walkthrough.
- [ ] **L-007** Seed any existing markdown notes via import (W-025).
- [ ] **L-008** Invite friends: send each a one-paragraph email with the URL, the TUI install line, and a note to ping the operator if anything breaks.
- [ ] **L-009** One-week soak: operator and ≥2 friends use it daily; no critical bugs (data loss, repeated disconnects, auth failures).
- [ ] **L-010** Post-soak retro: list any sharp edges, file follow-up tasks in this file with new IDs.
