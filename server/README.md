# @bartleby/server

Node + Hocuspocus collaboration server + REST API. SQLite storage. See top-level [`PRD.md`](../PRD.md) §7.3.

## Quick start

```sh
npm install
npm run dev    # tsx watch
npm test       # vitest
npm run lint
npm run typecheck
```

## Stack

- TypeScript (ESM, Node 22+).
- Hocuspocus for Yjs collaboration over WebSocket.
- SQLite via `better-sqlite3` (added in V-010).
- Vitest for tests.
- ESLint flat config + Prettier.
