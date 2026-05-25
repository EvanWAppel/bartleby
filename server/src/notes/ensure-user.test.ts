import { describe, expect } from 'vitest';
import { test } from '../db/test-fixture.js';
import { createUsersRepository } from '../db/repositories/users.js';
import { ensureUserExists } from './ensure-user.js';
import type { User } from '../auth/index.js';

function sessionUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-session-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    color: '#ff0080',
    createdAt: new Date('2026-05-23T00:00:00Z'),
    ...overrides,
  };
}

describe('ensureUserExists (S notes bridge)', () => {
  test('inserts the user into D users when missing', async ({ db }) => {
    const users = createUsersRepository(db);
    expect(users.findByEmail('alice@example.com')).toBeUndefined();

    const id = ensureUserExists(users, sessionUser());

    expect(id).toBe('u-session-1');
    const row = users.findById('u-session-1');
    expect(row).toEqual({
      id: 'u-session-1',
      email: 'alice@example.com',
      display_name: 'Alice',
      color: '#ff0080',
      created_at: '2026-05-23T00:00:00.000Z',
    });
  });

  test('returns the existing id (by email) when the user is already in D', async ({ db }) => {
    const users = createUsersRepository(db);
    users.insert({
      id: 'u-existing',
      email: 'alice@example.com',
      display_name: 'Alice (D)',
      color: '#222',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    // Session has a DIFFERENT id (e.g. fresh in-memory store) but same
    // email; we trust the D row.
    const id = ensureUserExists(users, sessionUser({ id: 'u-fresh-session' }));
    expect(id).toBe('u-existing');

    // We did not overwrite or duplicate the row.
    const row = users.findByEmail('alice@example.com');
    expect(row?.id).toBe('u-existing');
    expect(row?.display_name).toBe('Alice (D)');
  });

  test('email lookup is case/whitespace insensitive on the insert path', async ({ db }) => {
    const users = createUsersRepository(db);

    ensureUserExists(users, sessionUser({ email: '  Alice@Example.COM  ' }));

    // Stored normalized.
    const row = users.findByEmail('alice@example.com');
    expect(row).toBeDefined();
  });
});
