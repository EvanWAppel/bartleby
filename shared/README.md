# @bartleby/shared

The REST **wire contract** shared by the Bartleby web client and server: the exact JSON request/response shapes that cross the network, defined once.

Before this package, each response shape was declared twice — once in `server/src/**` (the producer) and once in `web/src/lib/api/**` (the consumer) — and nothing stopped the two copies drifting. This package is the single source of truth; both sides import it, so a change to the contract is a compile error on whichever side hasn't caught up.

## Design

- **Types only.** Every export is an `interface` / `type` — there is no runtime code. Both consumers import with `import type`, so the imports erase at build time. That means:
  - no build step (the package is consumed as source; `package.json` `types` points at `src/index.ts`);
  - no runtime dependency (the server's compiled `dist/` and the web bundle contain nothing from here).
- **Wire shapes, not client types.** Fields are snake_case, matching what the server actually serializes. Client-side conveniences (e.g. the web's camelCase `UserSummary` or `InboundBacklink` transforms) are derived from these and stay in the web layer.

## Consumption

Both `server/` and `web/` depend on it via a local path (`"@bartleby/shared": "file:../shared"`) as a devDependency (build/typecheck only). The production server Docker build uses the repo root as its build context so the sibling `shared/` directory is reachable at `npm ci` time.

## Layout

| File | Domain |
| --- | --- |
| `src/notes.ts` | notes, backlinks, import |
| `src/comments.ts` | comments |
| `src/snapshots.ts` | snapshots |
| `src/mentions.ts` | mentions |
| `src/users.ts` | users (mention picker) |
| `src/search.ts` | full-text search |
| `src/errors.ts` | the error envelope returned on any handled HTTP error |
