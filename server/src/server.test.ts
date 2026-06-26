import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createBartlebyServer, type BartlebyServer } from './server.js';
import { getFreePort } from './test-helpers/free-port.js';
import { buildSessionConfig, issueSessionJwt, SESSION_COOKIE_NAME } from './auth/session.js';
import { createInMemorySessionStore } from './auth/store.js';

/**
 * `ws`'s WebSocket constructor takes an options bag (3rd arg) where
 * `headers` is forwarded onto the upgrade request. HocuspocusProvider's
 * WebSocketPolyfill is invoked with `new Polyfill(url, protocols)`, so
 * we wrap it to inject custom headers on construction — this is how the
 * web-cookie auth path is exercised in tests (the browser sends the
 * Cookie header automatically; in Node we do it explicitly).
 */
function makeCookieWebSocketPolyfill(cookie: string): typeof globalThis.WebSocket {
  class CookieWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  return CookieWebSocket as unknown as typeof globalThis.WebSocket;
}

describe('Hocuspocus server (V-003)', () => {
  let server: BartlebyServer;
  let port: number;

  beforeAll(async () => {
    port = await getFreePort();
    server = await createBartlebyServer({ port });
  });

  afterAll(async () => {
    await server.destroy();
  });

  it('accepts a WebSocket connection and completes a Yjs handshake', async () => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'vertical-slice',
      document: ydoc,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sync timeout')), 5000);
        provider.on('synced', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      const ytext = ydoc.getText('body');
      ytext.insert(0, 'hello bartleby');
      expect(ytext.toString()).toBe('hello bartleby');
    } finally {
      provider.destroy();
    }
  });
});

describe('Hocuspocus bearer auth (A-010)', () => {
  let server: BartlebyServer;
  let port: number;
  const sessionConfig = buildSessionConfig({
    SESSION_SECRET: 'z'.repeat(48),
    NODE_ENV: 'test',
  });
  const store = createInMemorySessionStore();

  beforeAll(async () => {
    port = await getFreePort();
    server = await createBartlebyServer({
      port,
      auth: { sessionConfig, store },
    });
  });

  afterAll(async () => {
    await server.destroy();
  });

  it('rejects an unauthenticated provider', async () => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'auth-required',
      document: ydoc,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      token: null,
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('authentication failure timeout')), 5000);
        provider.on('authenticationFailed', () => {
          clearTimeout(timer);
          resolve();
        });
        provider.on('synced', () => {
          clearTimeout(timer);
          reject(new Error('unauthenticated provider synced'));
        });
      });
    } finally {
      provider.destroy();
    }
  });

  it('accepts a valid bearer token and completes a Yjs handshake', async () => {
    const user = await store.upsertUserByEmail({
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    const accessToken = await issueSessionJwt(sessionConfig, {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      jti: 'ws-auth-jti',
    });
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'auth-ok',
      document: ydoc,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      token: `Bearer ${accessToken}`,
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('authenticated sync timeout')), 5000);
        provider.on('synced', () => {
          clearTimeout(timer);
          resolve();
        });
        provider.on('authenticationFailed', ({ reason }) => {
          clearTimeout(timer);
          reject(new Error(`authentication failed: ${reason}`));
        });
      });
      ydoc.getText('body').insert(0, 'auth hello');
      expect(ydoc.getText('body').toString()).toBe('auth hello');
    } finally {
      provider.destroy();
    }
  });

  // Regression test (PR #45 fix): the web client doesn't send a
  // Hocuspocus bearer token — it relies on the bartleby_session cookie
  // already established by the OAuth flow. The auth hook must accept
  // that cookie when it arrives in the WS-upgrade `Cookie` header.
  it('accepts a valid session cookie from the upgrade headers (web client path)', async () => {
    const user = await store.upsertUserByEmail({
      email: 'bob@example.com',
      displayName: 'Bob',
    });
    const sessionJwt = await issueSessionJwt(sessionConfig, {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      jti: 'ws-cookie-jti',
    });
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'auth-ok-cookie',
      document: ydoc,
      // No `token` — mirrors what web/src/lib/Editor.svelte sends.
      WebSocketPolyfill: makeCookieWebSocketPolyfill(`${SESSION_COOKIE_NAME}=${sessionJwt}`),
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('cookie-auth sync timeout')), 5000);
        provider.on('synced', () => {
          clearTimeout(timer);
          resolve();
        });
        provider.on('authenticationFailed', ({ reason }) => {
          clearTimeout(timer);
          reject(new Error(`cookie authentication failed: ${reason}`));
        });
      });
      ydoc.getText('body').insert(0, 'cookie hello');
      expect(ydoc.getText('body').toString()).toBe('cookie hello');
    } finally {
      provider.destroy();
    }
  });

  it('rejects when neither bearer nor session cookie is present', async () => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'auth-required-neither',
      document: ydoc,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      token: null,
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('rejection timeout')), 5000);
        provider.on('authenticationFailed', () => {
          clearTimeout(timer);
          resolve();
        });
        provider.on('synced', () => {
          clearTimeout(timer);
          reject(new Error('connection synced despite no auth'));
        });
      });
    } finally {
      provider.destroy();
    }
  });

  it('rejects a tampered session cookie', async () => {
    // Sign a JWT with the WRONG secret so signature verification fails
    // against the server's sessionConfig.
    const wrongConfig = buildSessionConfig({
      SESSION_SECRET: 'q'.repeat(48),
      NODE_ENV: 'test',
    });
    const user = await store.upsertUserByEmail({
      email: 'mallory@example.com',
      displayName: 'Mallory',
    });
    const badJwt = await issueSessionJwt(wrongConfig, {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      jti: 'tampered-jti',
    });
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: 'auth-required-bad-cookie',
      document: ydoc,
      WebSocketPolyfill: makeCookieWebSocketPolyfill(`${SESSION_COOKIE_NAME}=${badJwt}`),
      connect: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('tamper-rejection timeout')), 5000);
        provider.on('authenticationFailed', () => {
          clearTimeout(timer);
          resolve();
        });
        provider.on('synced', () => {
          clearTimeout(timer);
          reject(new Error('synced with tampered cookie'));
        });
      });
    } finally {
      provider.destroy();
    }
  });
});
