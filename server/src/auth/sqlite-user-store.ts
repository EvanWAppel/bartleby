import type { UserRow } from '../db/repositories/types.js';
import type { UsersRepository } from '../db/repositories/users.js';
import {
  createInMemorySessionStore,
  type SessionStore,
  type UpsertUserInput,
  type User,
} from './store.js';

function toSessionUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Persists session identities in SQLite while retaining the existing
 * process-local storage for revocations and device authorization state.
 */
export function createSqliteUserSessionStore(users: UsersRepository): SessionStore {
  const transient = createInMemorySessionStore();

  return {
    ...transient,

    async upsertUserByEmail(input: UpsertUserInput): Promise<User> {
      const normalizedEmail = input.email.trim().toLowerCase();
      const existing = users.findByEmail(normalizedEmail);
      if (existing !== undefined) {
        return toSessionUser(existing);
      }

      const created = await transient.upsertUserByEmail({
        email: normalizedEmail,
        displayName: input.displayName,
      });
      return toSessionUser(
        users.insert({
          id: created.id,
          email: created.email,
          display_name: created.displayName,
          color: created.color,
          created_at: created.createdAt.toISOString(),
        }),
      );
    },

    async getUserById(id: string): Promise<User | null> {
      const row = users.findById(id);
      return row === undefined ? null : toSessionUser(row);
    },

    async listUsers(): Promise<User[]> {
      return users
        .list()
        .map(toSessionUser)
        .sort((a, b) => a.email.localeCompare(b.email));
    },
  };
}
