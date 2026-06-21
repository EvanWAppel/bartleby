// W-013: GET /users powers the @mention picker. We expose the union of
// the email allowlist and the in-memory users table — every allowlist
// row appears, with displayName/userId/color filled in for those who
// have signed in at least once. Email is the stable identifier.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { loadAllowlist } from '../auth/allowlist.js';
import { createInMemorySessionStore } from '../auth/store.js';
import { createUsersApp } from './routes.js';

function buildApp(emails: string): {
  app: ReturnType<typeof createUsersApp>;
  store: ReturnType<typeof createInMemorySessionStore>;
} {
  const allowlist = loadAllowlist({ BARTLEBY_ALLOWED_EMAILS: emails });
  const store = createInMemorySessionStore();
  const app = createUsersApp({ allowlist, store });
  return { app, store };
}

interface UserRow {
  email: string;
  display_name: string | null;
  user_id: string | null;
  color: string | null;
  signed_in: boolean;
}

describe('GET /users (W-013)', () => {
  it('returns every allowlist email, sorted by email', async () => {
    const { app } = buildApp('charlie@example.com,Alice@Example.com,bob@example.com');
    const res = await app.request('/users');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: UserRow[] };
    expect(body.users.map((u) => u.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'charlie@example.com',
    ]);
  });

  it('marks allowlist-only entries (no users-table row) as signed_in:false with null user info', async () => {
    const { app } = buildApp('alice@example.com');
    const res = await app.request('/users');
    const body = (await res.json()) as { users: UserRow[] };
    expect(body.users).toEqual([
      {
        email: 'alice@example.com',
        display_name: null,
        user_id: null,
        color: null,
        signed_in: false,
      },
    ]);
  });

  it('enriches signed-in users with their users-table row', async () => {
    const { app, store } = buildApp('alice@example.com,bob@example.com');
    const alice = await store.upsertUserByEmail({
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    const res = await app.request('/users');
    const body = (await res.json()) as { users: UserRow[] };
    const aliceRow = body.users.find((u) => u.email === 'alice@example.com');
    const bobRow = body.users.find((u) => u.email === 'bob@example.com');
    expect(aliceRow).toEqual({
      email: 'alice@example.com',
      display_name: 'Alice',
      user_id: alice.id,
      color: alice.color,
      signed_in: true,
    });
    expect(bobRow).toEqual({
      email: 'bob@example.com',
      display_name: null,
      user_id: null,
      color: null,
      signed_in: false,
    });
  });

  it('omits signed-in users whose email is no longer on the allowlist (allowlist is authoritative)', async () => {
    // Edge case: the operator removed someone from the allowlist after
    // they had signed in. The picker shouldn't surface them anymore.
    const { app, store } = buildApp('alice@example.com');
    await store.upsertUserByEmail({ email: 'ghost@example.com', displayName: 'Ghost' });
    const res = await app.request('/users');
    const body = (await res.json()) as { users: UserRow[] };
    expect(body.users.map((u) => u.email)).toEqual(['alice@example.com']);
  });

  it('is mountable with an auth gate (defers auth to the parent router)', async () => {
    // The endpoint itself does not gate; the parent in http.ts applies
    // requireSession. This test just confirms createUsersApp returns a
    // routable hono fragment that doesn't 401 on its own.
    const { app } = buildApp('alice@example.com');
    const root = new Hono();
    root.route('/', app);
    const res = await root.request('/users');
    expect(res.status).toBe(200);
  });
});
