import type { Database } from 'better-sqlite3';
import type { UserRow } from './types.js';

export interface UsersRepository {
  insert(user: UserRow): UserRow;
  findById(id: string): UserRow | undefined;
  findByEmail(email: string): UserRow | undefined;
  list(): UserRow[];
}

export function createUsersRepository(db: Database): UsersRepository {
  const insertStmt = db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (@id, @email, @display_name, @color, @created_at)`,
  );
  const findByIdStmt = db.prepare<[string], UserRow>(`SELECT * FROM users WHERE id = ?`);
  const findByEmailStmt = db.prepare<[string], UserRow>(`SELECT * FROM users WHERE email = ?`);
  const listStmt = db.prepare<[], UserRow>(`SELECT * FROM users ORDER BY created_at`);

  return {
    insert(user) {
      insertStmt.run(user);
      return user;
    },
    findById(id) {
      return findByIdStmt.get(id);
    },
    findByEmail(email) {
      return findByEmailStmt.get(email);
    },
    list() {
      return listStmt.all();
    },
  };
}
