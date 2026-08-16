# Architecture

This is the engineering design record for Bartleby — the decisions a systems reviewer would probe, as opposed to the product spec (that's [`PRD.md`](../PRD.md)). It covers why the system is shaped the way it is, not what features it has.

## The one hard thing

Bartleby has two first-class editing clients that share **no UI code and no runtime**:

- a **web client** — SvelteKit + ProseMirror, bound to a Yjs document via `y-prosemirror`;
- a **terminal client** — Python + Textual, bound to the same Yjs document via `y-py`.

Both are equal peers on one CRDT document, over one WebSocket, against one server. Neither is the "real" client the other mirrors. Everything below follows from taking that constraint seriously.

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

## Why a CRDT (Yjs), not OT

Real-time collaborative text has two mainstream approaches: Operational Transformation (OT) and Conflict-free Replicated Data Types (CRDTs).

OT relies on a central server to transform and sequence every operation against every concurrent operation. The transform functions are notoriously subtle, and — most relevant here — OT effectively assumes one authoritative implementation of the transform. Bartleby has two independent client implementations in two languages; maintaining transform-equivalence between a TypeScript and a Python OT engine would be a permanent correctness liability.

CRDTs move the merge guarantee into the data structure itself: any two replicas that have seen the same set of updates converge to the same state, regardless of order or timing, with no central transform step. That is exactly the property a two-language, two-client system needs. We use **Yjs**, the most mature JavaScript CRDT, because:

- It has a battle-tested rich-text type and a ProseMirror binding (`y-prosemirror`).
- It has a real (if lagging) Python port (`y-py`), which makes the terminal-as-a-true-peer idea feasible at all.
- Its "awareness" protocol gives us presence/cursors for free across both clients.

The tradeoff we accept: CRDTs carry per-character metadata, so documents are heavier than a plain-text OT log. For personal-scale notes that cost is irrelevant.

## The two-peer model

The core promise — "a browser and a terminal editing the same note" — only holds if both clients are genuinely peers, not one client plus a read-only viewer or a server-side shim.

- **Web:** `y-prosemirror` binds a ProseMirror `EditorState` to a shared Yjs `XmlFragment` named `prosemirror`. Local edits mutate the Yjs doc; remote updates apply back into ProseMirror.
- **Terminal:** `y-py` holds the same document. Local edits from the Textual UI go straight into the shared Yjs doc and propagate on the wire; remote updates apply to the local doc and re-render the terminal view.
- **Transport:** Both connect to the same [Hocuspocus](https://tiptap.dev/docs/hocuspocus) room over WebSocket. The room name is the **bare note UUID** — the same identifier the web client uses (`room={data.id}`) and the server resolves (`findById(documentName)`).

> **A real bug this model caught.** The concurrent-edit e2e (Q-002) surfaced that the TUI was joining room `note:<id>` while the web and server used the bare `<id>`. They were never actually in the same room, so TUI edits never reached the server's derived-state pipeline. The fix — making the TUI use the bare note id — is what makes the "web + TUI live peers" promise literally true. The convergence test now guards it in CI.

Schema agreement is the other half: both clients bind to the same node/mark schema (the server keeps a mirror in `server/src/derived/schema.ts`), so a heading, task list, or code block created in one client is the same node in the other.

## Server: source of truth and derived state

The Yjs document is canonical. Everything else is derived and re-computed, never hand-edited:

- The server persists Yjs document state as **binary blobs in SQLite** (via the Hocuspocus SQLite extension).
- On every **debounced** CRDT change, the server serializes the document to markdown and writes it to the note's `markdown_export` column.
- From that markdown it re-derives the note's **tags** and outbound **`[[backlinks]]`** into dedicated tables, and indexes the markdown in an FTS5 virtual table for search.

This "one source of truth, re-derive the rest on change" design means search, tags, and backlinks can never drift from the document — they are a pure function of it.

Live CRDT traffic goes over the Hocuspocus WebSocket. Everything that isn't live editing — note list, comment metadata, snapshots, the mentions inbox, import/export — is a small **typed REST/JSON API** alongside it. The web client consumes that API through a typed layer (`web/src/lib/api/*`) with explicit DTOs and a dedicated `NotesApiError`; errors are surfaced, never swallowed.

## Comment anchoring: surviving edits

Inline comments have to keep pointing at the right text even as the document is edited around (and through) them. Absolute character offsets would break the instant anyone types above the comment.

Instead, each comment stores a **Yjs `RelativePosition`** for each end of its anchored range (serialized as JSON `{ from, to }`, rooted in the `prosemirror` fragment). A `RelativePosition` is defined relative to CRDT items, not character offsets, so it tracks the same logical spot as text moves:

- To render or validate a comment, the server resolves each endpoint with `Y.createAbsolutePositionFromRelativePosition`. If **either** endpoint fails to resolve, the anchored span has been deleted and the comment is **orphaned**.
- Orphaned comments don't disappear. At creation time the server also computes the *text* between the endpoints (via `y-prosemirror`'s `relativePositionToAbsolutePosition` against a freshly built PM node tree) and stores it as `original_quote`. An orphan stays in the comments panel showing what it was originally about, and can still be replied to, resolved, or deleted.

The server recomputes the quote from the same Yjs source of truth the client used, so the stored snapshot can't drift from the document. See `server/src/comments/anchor.ts`.

## Authentication

- **Web:** Google OAuth via the standard web flow; the session is a JWT in an HTTP-only cookie.
- **Terminal:** OAuth **device-code** flow on first run — the TUI prints a URL and a code, polls the token endpoint, and stores the refresh token in the OS keychain via `keyring`. Subsequent runs are silent.
- **Allowlist:** The server enforces a hardcoded email allowlist on every authenticated request and at the WebSocket `onAuthenticate` hook, so both HTTP and CRDT traffic are gated. The concurrent-edit peer authenticates by passing the session JWT as the WS bearer, which `onAuthenticate` verifies.

## Operations

The production story is a single small VPS running Docker Compose with three services: the Bartleby Node app, a **Caddy** reverse proxy (automatic Let's Encrypt TLS, WebSocket upgrade), and a **Litestream** sidecar that streams the SQLite WAL continuously to an S3-compatible bucket for point-in-time backup. Restore is documented in [`ops/RESTORE.md`](../ops/RESTORE.md); rollout steps are in [`docs/LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md).

## Accepted risk: y-py maintenance

`y-py` lags `yrs` (the Rust Yjs port) and upstream JavaScript `yjs` in release cadence — it is the load-bearing dependency for the entire two-peer premise, and the least actively maintained. Mitigation:

- Pin Hocuspocus and `yjs` on the server to versions known to interop with the pinned `y-py`.
- Keep the web↔TUI convergence e2e ([`web/tests/web-tui-concurrent.test.ts`](../web/tests/web-tui-concurrent.test.ts)) in CI as a continuous interop smoke test — if a version bump breaks cross-language sync, this test fails.
- Revisit annually or on any sync incident; the fallback path is a thin PyO3 wrapper around `yrs` directly.

## Where to look in the code

| Concern | Path |
| --- | --- |
| Shared document schema (server mirror) | `server/src/derived/schema.ts` |
| Markdown / tags / backlinks derivation | `server/src/derived/` |
| Comment anchor resolution | `server/src/comments/anchor.ts` |
| Web comment anchoring | `web/src/lib/editor/comment-anchor.ts` |
| Typed web API layer | `web/src/lib/api/` |
| Web↔TUI convergence proof | `web/tests/web-tui-concurrent.test.ts`, `tui/tests/q002_tui_peer.py` |
