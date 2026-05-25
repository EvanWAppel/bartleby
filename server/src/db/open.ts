// Open a long-lived better-sqlite3 connection for the running server.
// Mirrors the pragma setup that the migrate CLI uses, so the runtime
// process talks to the file the same way migrations did.

import BetterSqlite3, { type Database } from 'better-sqlite3';

export function openDatabase(databasePath: string): Database {
  const db = new BetterSqlite3(databasePath);
  db.pragma('foreign_keys = ON');
  if (databasePath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  return db;
}
