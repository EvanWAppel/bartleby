// users: id (uuid TEXT), email (unique), display_name, color, created_at.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE users (
      id            TEXT PRIMARY KEY NOT NULL,
      email         TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      color         TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_users_email ON users(email);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS users;`);
}
