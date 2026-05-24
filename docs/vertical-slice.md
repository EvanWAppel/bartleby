# Vertical Slice (Phase 0)

This is the minimum proof that Bartleby's architecture works end-to-end:
**a ProseMirror web client and a textual TUI client edit the same Yjs document
through a Hocuspocus server, in both directions, live**.

If this works, all of Bartleby's hard architectural assumptions are validated;
every Phase 1+ task is incremental scope on top of this foundation.

## What's covered

| Task   | What it proves                                                  | Status |
| ------ | --------------------------------------------------------------- | ------ |
| V-001  | Monorepo layout (`server/`, `web/`, `tui/`, `ops/`, `docs/`).   | done   |
| V-002  | Server bootstrap (TS, vitest, ESLint, Prettier).                | done   |
| V-003  | Hocuspocus accepts a Yjs handshake (integration test).          | done   |
| V-004  | SvelteKit project + Playwright smoke covers `/`.                | done   |
| V-005  | ProseMirror + y-prosemirror editor; Playwright types "hello".   | done   |
| V-006  | Python TUI project (uv + textual + y-py + ruff + ty + prek).    | done   |
| V-007  | Hand-rolled Hocuspocus client; textual app renders a remote     |        |
|        | y-py peer's insert in real time (pytest pilot test).            | done   |
| V-008  | TextArea keystrokes mutate the YDoc and propagate to a separate |        |
|        | y-py peer through the server (pytest pilot test).               | done   |
| V-010  | SQLite persistence (Hocuspocus SQLite extension); state         |        |
|        | survives a server restart (integration test).                   | done   |
| V-011  | Re-verify cross-client round-trip after persistence is on.      | done   |

## How to drive it by hand

Open three terminals.

```sh
# Terminal 1 — Hocuspocus server (in-memory until V-010).
cd server
npm run dev      # listens on ws://127.0.0.1:1234
```

```sh
# Terminal 2 — SvelteKit web client.
cd web
npm run dev      # serves http://127.0.0.1:5173
```

```sh
# Terminal 3 — textual TUI client.
cd tui
uv run bartleby-tui     # connects to ws://127.0.0.1:1234 / "vertical-slice"
```

Open `http://127.0.0.1:5173` in a browser. You should see "Bartleby" plus a
ProseMirror editor mounted in the page. The terminal TUI shows an empty
TextArea bound to the same room.

### Verify cross-client sync (manual)

1. **Web → TUI.** Click into the web editor and type `hello from web`.
   Within a fraction of a second, the same text appears in the TUI's TextArea.
2. **TUI → web.** Focus the TUI terminal and type `, hello from tui`. The text
   appears at the front of the web editor (the TUI naively replaces the YDoc
   body on every keystroke in Phase 0, so cursor positions diverge — that's a
   v1 known limitation; a real merge ships in later phases).
3. **Two browser tabs.** Open the URL in a second tab; both tabs render the
   same content and edits in either flow to the other.
4. **Three peers.** Type in the TUI while a second browser tab is open and
   confirm the text reaches all three clients.

### Scripted equivalent

The same round-trip is asserted by automated tests, so you don't have to do
the manual dance to know it works:

- `web/tests/smoke.test.ts` (Playwright) — web client types into ProseMirror
  and reads the text back from the DOM.
- `tui/tests/test_connection.py` (pytest) — two y-py clients connected to a
  real Hocuspocus subprocess: a write on one shows up on the other.
- `tui/tests/test_app.py` (pytest+pilot) — a separate y-py peer pushes text;
  the textual app's widget displays it.
- `tui/tests/test_app_editing.py` (pytest+pilot) — keystrokes in the TUI
  TextArea propagate through the server to a peer.

Run everything:

```sh
make test         # if you've added the Makefile from R-007
# or, by component:
( cd server && npm test )
( cd web    && npm test && npm run test:e2e )
( cd tui    && uv run pytest )
```

## Architecture summary

```
┌─────────────────────┐                       ┌──────────────────────┐
│  SvelteKit web      │ ── Yjs WS ──────────▶ │                      │
│  ProseMirror +      │ ◀──────────────────── │  Hocuspocus (Node)   │
│  y-prosemirror      │                       │  in-memory storage   │
└─────────────────────┘                       │  no auth (Phase 0)   │
                                              │                      │
┌─────────────────────┐                       │  listens on 1234     │
│  textual TUI        │ ── Yjs WS ──────────▶ │                      │
│  textarea +         │ ◀──────────────────── │                      │
│  y-py +             │                       └──────────────────────┘
│  hand-rolled        │
│  Hocuspocus client  │
└─────────────────────┘
```

The TUI's Hocuspocus client (`tui/src/bartleby_tui/connection.py`) was hand
rolled because `ypy-websocket` does not interop with Hocuspocus's wire format
(Hocuspocus prepends `<docname:varstring>` to every frame; `ypy-websocket`
targets the simpler `y-websocket` reference server). The wire protocol is
documented inline in `tui/src/bartleby_tui/protocol.py`.

## Known v1 limitations (intentional, not bugs)

- **TUI uses full-text replace for local edits.** Every keystroke deletes the
  whole YDoc body and reinserts the new text. Inefficient and bad for
  concurrent editing; will be replaced by position-aware ops in a later task.
- **Initial paint from doc to TextArea is conservative.** If a remote peer
  inserts text *while you're typing*, the TUI won't auto-redraw — replacing
  the buffer mid-edit caused empty key events to mask user input. Real
  document-aware merge ships with the WYSIWYG-equivalent TUI renderer in
  Workstream T.
- **No auth.** Server accepts any token (empty included). Allowlist enforcement
  is Workstream A.
- **(was) In-memory storage.** As of V-010 the server persists Yjs state via
  `@hocuspocus/extension-sqlite`. The default is still `:memory:` so that
  tests stay hermetic; for a real run set `BARTLEBY_DB_PATH` to a file:

  ```sh
  BARTLEBY_DB_PATH=./bartleby.db npm run dev --prefix server
  ```

  Verified by `src/server.persistence.test.ts`: write text on one server
  instance, shut it down, start a fresh instance against the same DB path,
  and the text is still there. Manual equivalent:

  1. Start the server with a DB path as above.
  2. Open the web client and type something.
  3. Kill the server (Ctrl-C) and start it again with the same DB path.
  4. Reopen the web client; the text is still there.

## Screenshot / recording

(Operator to record an asciinema clip of the three-terminal flow and link it
here.)
