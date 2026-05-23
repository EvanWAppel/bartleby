# Bartleby

A small, self-hosted, collaborative notes app for a fixed group of friends. Two first-class clients (web + TUI) edit the same notes in real time via a shared CRDT.

See [`PRD.md`](./PRD.md) for the product spec and [`TASKS.md`](./TASKS.md) for the build plan.

## Repo layout

| Path      | What lives here                                                     |
| --------- | ------------------------------------------------------------------- |
| `server/` | Node + Hocuspocus collaboration server + REST API, SQLite storage.  |
| `web/`    | SvelteKit web client (ProseMirror WYSIWYG editor + y-prosemirror).  |
| `tui/`    | Python + textual + y-py terminal client.                            |
| `ops/`    | Docker Compose, Caddyfile, Litestream config, deploy/restore docs.  |
| `docs/`   | Architecture notes, design records, vertical-slice walkthroughs.    |

## Running locally

Each component has its own README with details. Quick start:

```sh
# Server (Node 26, npm)
cd server && npm install && npm run dev

# Web (SvelteKit)
cd web && npm install && npm run dev

# TUI (Python 3.12 via uv)
cd tui && uv sync && uv run bartleby-tui
```

For a coordinated dev environment, `make dev` (or `just dev`) brings up all three.

## Status

Pre-alpha. Working through Phase 0 (vertical slice) per `TASKS.md`.
