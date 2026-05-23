# Bartleby — Product Requirements

## 1. Overview

Bartleby is a small, self-hosted, collaborative notes app for a fixed group of friends. It has two first-class clients: a Google Docs–like web editor and a terminal UI. Both speak the same real-time collaborative protocol, so two friends — one in a browser, one in a terminal — can edit the same note together with live cursors.

The product is deliberately small in audience (3–6 people, invite-only) and deliberately ambitious in editor experience (real-time CRDT collaboration, comments, version history, backlinks).

## 2. Users

- **The group.** A fixed, whitelisted set of 3–6 friends (operator + invitees). All authenticate via Google OAuth against a hardcoded email allowlist.
- **The operator.** One of the friends (you) runs the VPS, holds the allowlist, and is responsible for backups and uptime.
- **No other users.** No public signup, no anonymous readers, no external collaborators in v1.

## 3. Goals

- Let friends co-write and organize notes together, in real time, with the editing fidelity of Google Docs.
- Provide a TUI client with full feature parity, so notes are usable from a terminal (over SSH, on a server, in a tmux pane).
- Be cheap to operate (single small VPS) and trivially backed up.
- Be portable: friends can always export everything as plain markdown and walk away.

## 4. Non-Goals (v1)

- **Public sharing or read-only links to non-group members.** Notes are never accessible outside the whitelisted group.
- **Native mobile apps (iOS/Android).** Mobile is web-only and read-only.
- **AI features** (summaries, suggestions, semantic search). Search is keyword-only.
- **Payments, billing, multi-tenancy, public signup.** Single-tenant friend group only.

## 5. Success Criteria

v1 is successful if, one month after launch:

- The operator and at least two other friends are using Bartleby at least weekly.
- No data-loss incidents have occurred.

This is a deliberately lightweight bar appropriate for a friend-group side project.

## 6. Content Model

### 6.1 What a note is

A note is a rich-text document with a stable UUID identity and a mutable human-readable title. Its canonical representation is a CRDT document (Yjs, via the y-prosemirror schema). Markdown is supported as an import and export format only — it is not the source of truth at rest.

### 6.2 Supported markdown features

The ProseMirror schema, markdown serializer, and TUI renderer all support exactly this set in v1:

- Headings (H1–H6)
- Inline marks: bold, italic, strikethrough
- Links
- Bullet lists, ordered lists
- Blockquotes
- Task lists (`- [ ]` / `- [x]`)
- Fenced code blocks with syntax highlighting

Explicitly out of scope for v1: tables, image embeds, math/LaTeX, footnotes, callouts, embeds of any kind.

### 6.3 Organization

- **Flat namespace** — no folders.
- **Tags** — any number per note; a sidebar/list view groups notes by tag.
- **Backlinks** — `[[Note Title]]` syntax links between notes. The title resolves to a UUID through an alias table maintained by the server, so titles can change without breaking links. An "inbound links" pane shows what links to the current note.

### 6.4 Note identity and rename

- Notes are identified by UUID. URLs and CRDT documents key on UUID.
- Titles are mutable display strings. The server maintains a `title → uuid` alias table updated whenever a note is created or renamed; old titles continue to resolve (with a warning surface if a stale title is ambiguous) until the alias table is pruned.
- Rename has no blast radius and never rewrites other notes' content.

## 7. Architecture

### 7.1 High level

```
┌─────────────┐                      ┌──────────────────────┐
│  Web client │ ── Yjs over WS ────▶ │                      │
│ (ProseMirror│ ◀── REST/JSON ────── │  Bartleby server     │
│  + WYSIWYG) │                      │  (Node + Hocuspocus) │
└─────────────┘                      │                      │
                                     │  SQLite + FTS5       │
┌─────────────┐                      │  Resend (email)      │
│  TUI client │ ── Yjs over WS ────▶ │  Litestream → S3     │
│ (Python +   │ ◀── REST/JSON ────── │                      │
│  textual +  │                      └──────────────────────┘
│  y-py)      │
└─────────────┘
```

### 7.2 Source of truth

A Yjs document (rich-text tree via the y-prosemirror schema) is the canonical state of every note. The server persists Yjs document state as binary blobs in SQLite. Markdown is generated on-demand:

- On every debounced CRDT change, the server serializes the document to markdown and writes the result to the note's `markdown_export` column (used for FTS indexing and ad-hoc export).
- Tag list and outbound `[[backlinks]]` are extracted from the markdown export on the same trigger and written to dedicated tables.

### 7.3 Server stack

- **Runtime:** Node.js.
- **Collab:** Hocuspocus (the de-facto Yjs collab server). Provides Yjs WebSocket transport, persistence hooks, authentication hooks, and an extension model for snapshots/comments.
- **Storage:** SQLite (single file). Hocuspocus SQLite extension for Yjs blobs; hand-written tables for the metadata described in §7.5.
- **HTTP layer:** A small REST/JSON API alongside the Hocuspocus WebSocket for everything that isn't live CRDT traffic (note list, tags, backlinks, comments metadata, snapshots, mentions inbox, import/export).
- **Auth:** Google OAuth for the web client; an OAuth device-code flow for the TUI. Server enforces a hardcoded email allowlist on every authenticated request.
- **TLS:** Caddy reverse proxy in front, automatic Let's Encrypt provisioning.
- **Email:** Resend, used only for @mention notifications.
- **Backups:** Litestream streams the SQLite WAL continuously to an S3-compatible bucket (Backblaze B2 or Cloudflare R2 recommended for cost).
- **Hosting:** A single small VPS (Hetzner, Fly, or similar). Deployed as Docker Compose: one service for the Bartleby Node app, one for Caddy, one for the Litestream sidecar.

### 7.4 Web client

- **Framework:** TBD (recommend SvelteKit or Next.js; either works). The non-trivial code lives in the editor, not the framework.
- **Editor:** ProseMirror with a y-prosemirror binding to a shared Yjs document. WYSIWYG behavior: users see formatted text (Notion/Typora feel), use keyboard shortcuts and a minimal toolbar; markdown syntax is invisible during editing.
- **Auth:** Google OAuth via standard web flow; session cookie.
- **Mobile:** Read-only view at the same URLs. Desktop-targeted UI on tablet and below redirects to a clean reader.

### 7.5 SQLite schema (sketch)

Authoritative tables:

- `users` — id, email, display_name, color (auto-assigned for cursor presence), created_at.
- `notes` — id (uuid), title, created_by, created_at, updated_at, trashed_at (nullable, for soft-delete), markdown_export (text, kept in sync), yjs_state (blob, written by Hocuspocus).
- `note_titles_history` — note_id, title, valid_from, valid_to (nullable). Used to resolve old `[[backlinks]]` to current UUIDs.
- `tags` — note_id, tag. Unique (note_id, tag). Re-derived on every Yjs change.
- `backlinks` — source_note_id, target_note_id, link_text. Re-derived on every Yjs change.
- `comments` — id, note_id, author_id, parent_comment_id (nullable, for threading), anchor (yjs relative position, serialized), original_quote (text snapshot for orphans), body, created_at, resolved_at (nullable).
- `snapshots` — id, note_id, yjs_state (blob), created_at, label (nullable; null = auto-snapshot, non-null = named).
- `mentions` — id, note_id, mentioned_user_id, mentioning_user_id, source (comment_id or note context), created_at, read_at (nullable), email_sent_at (nullable).

A virtual `notes_fts` FTS5 table indexes `notes.markdown_export` for search.

### 7.6 TUI client

- **Stack:** Python + textual + y-py. (See §13.1 on the accepted maintenance risk.)
- **Tooling:** uv for environment and dependency management, pytest for tests, ruff for lint, ty for typecheck, prek for pre-commits. (Per `agents.md`.)
- **CRDT:** y-py participates directly in the Yjs session as a full peer. Local edits go straight into the shared document and propagate on the wire; remote edits apply to the local document and re-render.
- **Rendering of rich text in the terminal:**
  - Headings: bold + colored line, sized by indentation/marker.
  - Bold/italic/strike: terminal escape sequences.
  - Links: underlined + colored, with a footnote-style `[1]` numbering shown in a margin or status pop.
  - Lists: indented with bullet/number markers; task lists render as `[ ]` / `[x]` and toggle with Space.
  - Code blocks: rendered with a syntax highlighter (pygments) inside a bordered region.
  - Blockquote: left bar + dimmed text.
- **Editing model:** Users do not type markdown syntax. Bold is `Ctrl-B`; headings are entered via `#`/`##` on an empty line which is consumed and replaced by a heading node (same convention as the web editor); links via `Ctrl-K`; etc. Full keybind reference shipped as `?` help overlay.
- **Presence display:** Status bar shows the list of users currently in the open note with their assigned colors and cursor line numbers, e.g. `● alice L42  ● bob L17  ● you L42`.
- **Offline behavior:** On network drop, the TUI continues to accept edits; Yjs queues operations locally and syncs on reconnect. A status-bar indicator shows connection state (`● live` / `○ offline — N pending`).
- **Authentication:** OAuth device-code flow on first run. TUI prints `Visit https://bartleby.example.com/device and enter code ABCD-EFGH`, polls the token endpoint, and stores the refresh token in the OS keychain (via `keyring`). Subsequent runs are silent.

### 7.7 TUI feature scope

The TUI ships with full parity:

- **Notes list** with search (`/`), tag filter, and sort.
- **Full CRUD** — create, rename, delete (soft), restore from trash, edit tags.
- **Backlink navigation** — press a key on a `[[link]]` to follow it; "inbound links" pane (`g b`) lists notes that link to the current one.
- **Inline comments** — read, write, reply, resolve. Rendered as numbered markers in the text; a side panel (`g c`) lists comment threads with their anchored quotes. Orphaned comments (anchor text deleted) appear in the panel with their original quoted text and a visual "orphaned" tag.
- **Version history** — `g h` opens a scrollable list of snapshots (auto and named), with a preview pane and "restore" action.

## 8. Real-Time Collaboration Features

### 8.1 Live editing

- All clients are full Yjs peers. Cursors and edits propagate live in both directions.
- Per-user color assigned at user creation and reused everywhere presence is shown.
- Awareness state (cursor, selection) propagates via Yjs awareness protocol.

### 8.2 Comments

- Anchored to CRDT-relative positions (Yjs `RelativePosition`), so they track text as it moves.
- If the anchored range is deleted, the comment becomes "orphaned": it remains in the comments panel with its original quoted text snapshot, but no longer points into the body. Orphans can be replied to, resolved, or deleted normally.
- Threaded one level deep (top-level comment plus replies).
- Resolved comments are hidden from the in-body markers by default but remain in the panel under a "Resolved" filter.

### 8.3 Version history

- **Auto-snapshots:** every ~5 minutes per note, taken only if the document changed since the previous snapshot.
- **Named snapshots:** any user can name the current state ("Pre-edit by Alice", "Trip plan v2"). Named snapshots are never auto-pruned.
- **Auto-snapshot retention:** the most recent 50 auto-snapshots per note; older auto-snapshots are pruned. (Named snapshots are exempt.)
- **Restore** loads a snapshot's Yjs state and replaces the current document atomically (with an implicit "Restored from snapshot X" auto-snapshot of the pre-restore state, so restores are themselves undoable).

### 8.4 @mentions

- Typing `@` opens a small picker of the five friends (the allowlist).
- Triggerable inside note bodies and inside comments.
- Each completed mention writes a `mentions` row and surfaces in the mentioned user's in-app inbox (a small badge + dropdown in both clients).
- Email notifications use Resend, batched within a 60-second sliding window: multiple mentions to the same user within 60s collapse into one email with a summary.

## 9. Authentication and Permissions

### 9.1 Authentication

- Google OAuth (standard authorization-code flow for web; device-code flow for TUI).
- Server holds a hardcoded `allowed_emails` list. Any successful OAuth response with an email not on the list is rejected at the session-creation step.
- New friend onboarding: operator edits the allowlist (config file or env var) and redeploys; friend signs in.

### 9.2 Permissions

Fully shared. Every authenticated group member can:

- See every note (including trashed notes).
- Edit every note.
- Comment on any note.
- Rename, tag, delete, and restore any note.
- Create snapshots; restore any snapshot.

There are no per-note ACLs and no role distinctions. The trust model is the friend group.

### 9.3 Soft delete

- Deletes set `trashed_at`. Trashed notes are hidden from the default list but accessible via a "Trash" view, and restorable by anyone.
- A background job purges notes whose `trashed_at` is older than 30 days, including their Yjs state, comments, snapshots, and mention rows.

## 10. Import and Export

- **Import (web only):** drag-and-drop one or more `.md` files onto the notes list. Each file becomes a new note (title from filename or first `# heading`); body is parsed through the markdown-to-ProseMirror serializer.
- **Export all (web and TUI):** "Export all as zip" produces a flat zip of one `.md` file per note. Filenames are slugified titles; tags are stored as a YAML frontmatter block per file (`tags: [foo, bar]`).
- **Export one:** "Copy as markdown" (web) and `:export` (TUI) for a single note.

## 11. Operations

### 11.1 Hosting

- Single small VPS (recommend Hetzner CX22 or Fly shared-1x as a starting point).
- Domain: subdomain of a domain you already own (e.g., `bartleby.<yourdomain>`).
- Caddy reverse proxy in front, automatic TLS via Let's Encrypt.

### 11.2 Deployment

- Docker Compose with three services: `bartleby` (the Node app), `caddy`, `litestream`.
- Deploys via `git pull && docker compose up -d --build` from the VPS. CI is overkill for v1.

### 11.3 Backups

- Litestream continuously replicates SQLite to an S3-compatible bucket (Backblaze B2 or Cloudflare R2).
- Restore procedure documented in the repo's `OPERATIONS.md` (out of scope here).
- Manual test of restore at least once before launch.

### 11.4 Logging and observability

- Structured JSON logs from the Node server (pino).
- No external monitoring service in v1. Operator checks logs on the VPS when problems are reported.

## 12. UX Surface — Selected Details

### 12.1 Web layout

- Left sidebar: notes list with search box at top, tag filter chips below, "New note" button. "Trash" and "Inbox" (mentions) accessible from a footer area.
- Main pane: the open note. Title at top (editable in place), tag chips below the title, body editor below that.
- Right pane (collapsible): comments panel, inbound links panel, snapshots panel — switchable tabs.

### 12.2 TUI layout

```
┌─ notes ───────────┬─ Trip to Spain ──────────────────────┐
│ /search           │ # Trip to Spain                      │
│                   │                                      │
│ ● Trip to Spain   │ A few ideas for the week:            │
│   Reading list    │                                      │
│   Recipes         │ - [x] book flights                   │
│   Movie night     │ - [ ] book apartments                │
│   ...             │ - [ ] confirm with [[Alice]]         │
│                   │                                      │
│ tags: travel,     │ See also: [[Madrid food list]]       │
│       reading,    │                                      │
│       cooking     │                                      │
├───────────────────┴──────────────────────────────────────┤
│ ● live  ● alice L4  ● you L6   ?:help  g:goto  c:comments│
└──────────────────────────────────────────────────────────┘
```

Keybinds are vim-flavored but discoverable via `?`. Notable: `g c` comments, `g b` backlinks, `g h` history, `g t` trash, `g i` inbox, `/` search, `:` command palette.

### 12.3 Mobile web

- Reads only. Same URL scheme. Editor swapped for a rendered view. No comment composer, no editor toolbar. A banner offers a `mailto:` to email the desktop URL to yourself.

## 13. Risks and Open Items

### 13.1 y-py maintenance risk (accepted)

y-py lags yrs (the Rust Yjs port) and the upstream JavaScript yjs library in release cadence. Mitigation:

- Pin Hocuspocus and yjs versions on the server side to versions y-py is known to interop with.
- Add a smoke test in CI that round-trips a non-trivial document between a y-py client and the server.
- Revisit annually or on any sync incident; fall-back path is a PyO3 wrapper around yrs.

### 13.2 WYSIWYG + remote-edit cursor stability

ProseMirror + y-prosemirror handles most cases, but unusual edits (e.g., a remote user changing block structure while a local user is mid-IME input) have known edge cases. Acceptance: occasional minor cursor jumps are OK; data corruption is not. Mitigation: keep snapshots frequent.

### 13.3 Comment anchoring on heavy refactor

If a user reorganizes a note significantly, many comments may orphan. The orphans-in-sidebar pattern keeps them recoverable but the in-body context is lost. No mitigation planned for v1.

### 13.4 Single-VPS single-point-of-failure

If the VPS dies, the app is down until restored. Litestream gives a low-RPO recovery path but RTO is "however long it takes the operator to spin up a new VPS and restore." Acceptable for v1.

### 13.5 Open items for the build phase

- Choice of web framework (SvelteKit vs Next.js vs SolidStart) — no architectural impact, pick based on operator preference.
- Choice of S3-compatible backup provider (Backblaze B2 vs Cloudflare R2) — cost difference is small at this scale.
- Exact set of TUI keybinds — derive from textual conventions plus the named goto set above; finalize during the TUI build.
- Whether the in-app mentions inbox lives in the sidebar or as a dedicated route.

## 14. v1 Scope and Release

v1 is a single release containing everything in this document. There is no staged rollout. The operator deploys it to the VPS, adds the friend group to the allowlist, and the group starts using it.

The launch checklist:

- Allowlist populated.
- Litestream backup verified by a test restore.
- A `.md` import of any existing notes the operator wants to seed the app with.
- A short "how to install the TUI" note on the README (or in a pinned note inside Bartleby itself, naturally).
