# Bartleby database layer

SQLite-only. Migrations are TypeScript files run by [umzug](https://github.com/sequelize/umzug) against a [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) connection.

## Choice of tooling (D-001)

- **Driver:** `better-sqlite3`. Synchronous API, already present as a transitive dep of `@hocuspocus/extension-sqlite`. No connection pool needed — SQLite is single-writer.
- **Migration runner:** `umzug`. Programmatic + CLI, supports custom storage, file-glob discovery, idempotent `up`/`down`.
- **Bookkeeping table:** `_migrations (name TEXT PRIMARY KEY, executed_at TEXT)`. Created on first run.

## Layout

```
src/db/
├── README.md            (this file)
├── migrator.ts          umzug + SqliteStorage wiring (createMigrator)
├── migrate.ts           CLI entrypoint (up|down|down:all|status)
├── test-fixture.ts      in-memory-per-test fixture + raw createTestDatabase
└── migrations/
    └── NNN_description.ts   each exports up(db) and down(db)
```

Each migration file exports `up(db: Database)` and `down(db: Database)`. `down` must reverse `up` such that `up → down → up` produces the same schema as a single fresh `up`. The migrator tests in `migrator.test.ts` enforce this round-trip property for the whole stack.

## Running migrations

```sh
npm run migrate:up        # apply all pending
npm run migrate:down      # revert one (most recent)
npm run migrate:down:all  # revert everything
npm run migrate:status    # show executed + pending
```

`BARTLEBY_DB_PATH` (default `./bartleby.db`) selects the file. The CLI enables `foreign_keys` and `journal_mode = WAL` for file-backed databases.

## Yjs blob storage and the metadata bridge

The Yjs document state is **not** owned by the migration layer. `@hocuspocus/extension-sqlite` (loaded in `src/server.ts`) auto-creates a sibling table on the same SQLite file:

```sql
CREATE TABLE IF NOT EXISTS "documents" (
  "name" varchar(255) NOT NULL,
  "data" blob NOT NULL,
  UNIQUE(name)
);
```

`documents.data` holds the current Yjs state for one document; `documents.name` is the Hocuspocus document name. Our migrated `notes` table holds **metadata only** (`id`, `title`, `created_by`, `created_at`, `updated_at`, `trashed_at`, `markdown_export`). There is no `yjs_state` column on `notes`.

The bridge between the two tables is the note uuid:

- `notes.id` (uuid) **equals** `documents.name` for the live document.
- Code that wants the live Yjs blob does so through Hocuspocus, never by reading `documents` directly.
- Hard deletes (the 30-day trash purge in S-010) must remove the matching `documents` row as well as the `notes` row; that join happens in application code because `documents` is outside the umzug-managed schema.

`snapshots` (D-008) is a separate concern: each row carries its own `yjs_state` blob (a frozen copy of the live document at snapshot time). Snapshots do not piggyback on the Hocuspocus `documents` table.

## Test fixture (D-012)

Tests should `import { test } from '../test-fixture.js'` and write `test('case', ({ db }) => …)`. Each test gets a freshly migrated in-memory database that is closed after the test exits. For the rare case that you want two databases in the same test, call `createTestDatabase()` directly and close it yourself.

## Repository layer (D-011)

Application code should not write raw SQL. Instead, import from `./repositories`:

```ts
import { createRepositories } from './db/repositories/index.js';

const repos = createRepositories(db);
const note = repos.notes.findById('…');
repos.tags.replaceForNote(noteId, ['travel', 'food']);
const hits = repos.search.searchNotes('paella');
```

Each table has its own file under `repositories/` exporting a typed factory (`createXRepository(db)`) plus the row interface. The aggregate `Repositories` interface and `createRepositories(db)` are exported from `repositories/index.ts`. Functions are kept narrow — only what S/C/M/I will consume; add methods as those workstreams need them.
