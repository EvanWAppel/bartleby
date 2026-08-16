import { describe, expect } from 'vitest';
import { createUsersRepository } from '../db/repositories/users.js';
import { test } from '../db/test-fixture.js';
import { createSqliteUserSessionStore } from './sqlite-user-store.js';

describe('SQLite-backed session users', () => {
  test('a new store resolves an existing user after a process restart', async ({ db }) => {
    const users = createUsersRepository(db);
    const beforeRestart = createSqliteUserSessionStore(users);
    const signedIn = await beforeRestart.upsertUserByEmail({
      email: 'Alice@Example.com',
      displayName: 'Alice',
    });

    const afterRestart = createSqliteUserSessionStore(users);

    await expect(afterRestart.getUserById(signedIn.id)).resolves.toEqual(signedIn);
    await expect(afterRestart.listUsers()).resolves.toEqual([signedIn]);
  });

  test('reuses the persisted identity when the same email signs in again', async ({ db }) => {
    const users = createUsersRepository(db);
    const firstStore = createSqliteUserSessionStore(users);
    const first = await firstStore.upsertUserByEmail({
      email: 'alice@example.com',
      displayName: 'Alice',
    });

    const restartedStore = createSqliteUserSessionStore(users);
    const second = await restartedStore.upsertUserByEmail({
      email: ' ALICE@example.com ',
      displayName: 'Alice Updated',
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe('alice@example.com');
    expect(users.list()).toHaveLength(1);
  });
});
