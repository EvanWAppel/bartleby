import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemorySessionStore, type SessionStore } from './store.js';

describe('in-memory session store (A-001..A-005)', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = createInMemorySessionStore();
  });

  describe('users', () => {
    it('upserts a user by email; returns a stable id on second upsert', async () => {
      const a = await store.upsertUserByEmail({
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      const a2 = await store.upsertUserByEmail({
        email: 'alice@example.com',
        displayName: 'Alice (renamed)',
      });
      expect(a.id).toBe(a2.id);
      expect(a2.displayName).toBe('Alice (renamed)');
    });

    it('normalizes email to lowercase on upsert and lookup', async () => {
      const a = await store.upsertUserByEmail({
        email: 'Alice@Example.com',
        displayName: 'Alice',
      });
      expect(a.email).toBe('alice@example.com');
      const a2 = await store.upsertUserByEmail({
        email: 'ALICE@example.COM',
        displayName: 'Alice',
      });
      expect(a2.id).toBe(a.id);
    });

    it('assigns a deterministic color from email (stable across upserts)', async () => {
      const a = await store.upsertUserByEmail({
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      const b = await store.upsertUserByEmail({
        email: 'bob@example.com',
        displayName: 'Bob',
      });
      // Same email → same color across separate stores (deterministic).
      const otherStore = createInMemorySessionStore();
      const a2 = await otherStore.upsertUserByEmail({
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      expect(a.color).toBe(a2.color);
      // Different emails → different colors (palette has > 1 entry).
      expect(a.color).not.toBe(b.color);
      // Looks like #RRGGBB.
      expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('getUserById returns the user; null when unknown', async () => {
      const a = await store.upsertUserByEmail({
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      const fetched = await store.getUserById(a.id);
      expect(fetched?.email).toBe('alice@example.com');
      expect(await store.getUserById('nope')).toBeNull();
    });

    // W-013: listUsers powers the GET /users mention picker. Order is
    // by lowercase email so the picker (and tests) get a stable list.
    it('listUsers returns every upserted user, sorted by email', async () => {
      expect(await store.listUsers()).toEqual([]);
      await store.upsertUserByEmail({ email: 'charlie@example.com', displayName: 'Charlie' });
      await store.upsertUserByEmail({ email: 'Alice@Example.com', displayName: 'Alice' });
      await store.upsertUserByEmail({ email: 'bob@example.com', displayName: 'Bob' });
      const users = await store.listUsers();
      expect(users.map((u) => u.email)).toEqual([
        'alice@example.com',
        'bob@example.com',
        'charlie@example.com',
      ]);
      expect(users.map((u) => u.displayName)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('listUsers reflects displayName changes after a re-upsert', async () => {
      await store.upsertUserByEmail({ email: 'alice@example.com', displayName: 'Alice' });
      await store.upsertUserByEmail({ email: 'alice@example.com', displayName: 'Alice II' });
      const users = await store.listUsers();
      expect(users).toHaveLength(1);
      expect(users[0]?.displayName).toBe('Alice II');
    });
  });

  describe('jti revocation', () => {
    it('revokeJti / isJtiRevoked round-trip', async () => {
      expect(await store.isJtiRevoked('j1')).toBe(false);
      await store.revokeJti('j1');
      expect(await store.isJtiRevoked('j1')).toBe(true);
      expect(await store.isJtiRevoked('j2')).toBe(false);
    });
  });
});
