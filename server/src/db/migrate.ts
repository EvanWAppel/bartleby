// CLI: `tsx src/db/migrate.ts up|down|status`.
//
// Uses BARTLEBY_DB_PATH (default `./bartleby.db`). Opens with WAL +
// foreign_keys enforcement, then runs the requested command.

import BetterSqlite3 from 'better-sqlite3';
import { createMigrator } from './migrator.js';

const cmd = process.argv[2] ?? 'up';
const dbPath = process.env.BARTLEBY_DB_PATH ?? './bartleby.db';

async function main(): Promise<void> {
  const db = new BetterSqlite3(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  const migrator = createMigrator(db);

  try {
    switch (cmd) {
      case 'up': {
        const applied = await migrator.up();
        console.log(
          `applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ') || '(none)'}`,
        );
        break;
      }
      case 'down': {
        const reverted = await migrator.down();
        console.log(
          `reverted ${reverted.length} migration(s): ${reverted.map((m) => m.name).join(', ') || '(none)'}`,
        );
        break;
      }
      case 'down:all': {
        const reverted = await migrator.down({ to: 0 });
        console.log(`reverted ${reverted.length} migration(s)`);
        break;
      }
      case 'status':
      case 'pending': {
        const executed = await migrator.executed();
        const pending = await migrator.pending();
        console.log(`executed: ${executed.map((m) => m.name).join(', ') || '(none)'}`);
        console.log(`pending:  ${pending.map((m) => m.name).join(', ') || '(none)'}`);
        break;
      }
      default:
        console.error(`unknown command: ${cmd}\nusage: migrate up | down | down:all | status`);
        process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
