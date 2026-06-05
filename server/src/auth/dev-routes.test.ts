import { describe, it, expect } from 'vitest';
import { buildSessionConfig } from './session.js';
import { createInMemorySessionStore } from './store.js';
import { createDevAuthApp } from './dev-routes.js';

const baseEnv = { SESSION_SECRET: 'x'.repeat(48) };

function build() {
  const sessionConfig = buildSessionConfig(baseEnv);
  const store = createInMemorySessionStore();
  const app = createDevAuthApp({ sessionConfig, store });
  return { app, store, sessionConfig };
}

describe('POST /auth/dev/sign-in (test-only)', () => {
  it('upserts the user, mints a session JWT, returns user + Set-Cookie', async () => {
    const { app, store } = build();
    const res = await app.request('http://localhost/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', displayName: 'Alice' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; email: string; display_name: string };
    expect(body.email).toBe('alice@example.com');
    expect(body.display_name).toBe('Alice');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('bartleby_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    // Same email a second time returns the same id (upsert).
    const res2 = await app.request('http://localhost/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });
    const body2 = (await res2.json()) as { id: string };
    expect(body2.id).toBe(body.id);

    // Both invocations populated the store with the same user id.
    const user = await store.getUserById(body.id);
    expect(user?.email).toBe('alice@example.com');
  });

  it('defaults displayName to the email local-part when not supplied', async () => {
    const { app } = build();
    const res = await app.request('http://localhost/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com' }),
    });
    const body = (await res.json()) as { display_name: string };
    expect(body.display_name).toBe('bob');
  });

  it('400 when body is not JSON', async () => {
    const { app } = build();
    const res = await app.request('http://localhost/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('400 when email is missing', async () => {
    const { app } = build();
    const res = await app.request('http://localhost/auth/dev/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
