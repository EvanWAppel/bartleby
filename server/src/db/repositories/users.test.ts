import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createUsersRepository } from './users.js';

const alice = {
  id: 'u-alice',
  email: 'alice@example.com',
  display_name: 'alice',
  color: '#ff0000',
  created_at: '2026-05-23T00:00:00.000Z',
};

const bob = {
  id: 'u-bob',
  email: 'bob@example.com',
  display_name: 'bob',
  color: '#00ff00',
  created_at: '2026-05-23T00:01:00.000Z',
};

describe('UsersRepository', () => {
  test('insert + findById round-trip', ({ db }) => {
    const repo = createUsersRepository(db);
    repo.insert(alice);
    expect(repo.findById('u-alice')).toEqual(alice);
  });

  test('findById returns undefined for unknown id', ({ db }) => {
    const repo = createUsersRepository(db);
    expect(repo.findById('nope')).toBeUndefined();
  });

  test('findByEmail returns the user', ({ db }) => {
    const repo = createUsersRepository(db);
    repo.insert(alice);
    expect(repo.findByEmail('alice@example.com')).toEqual(alice);
    expect(repo.findByEmail('nope@example.com')).toBeUndefined();
  });

  test('list returns users in created_at order', ({ db }) => {
    const repo = createUsersRepository(db);
    repo.insert(bob);
    repo.insert(alice);
    expect(repo.list().map((u) => u.id)).toEqual(['u-alice', 'u-bob']);
  });

  test('insert rejects duplicate email (UNIQUE constraint surfaces)', ({ db }) => {
    const repo = createUsersRepository(db);
    repo.insert(alice);
    expect(() => repo.insert({ ...alice, id: 'u-other' })).toThrow(/UNIQUE/);
  });
});
