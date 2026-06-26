import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createBartlebyServer, type BartlebyServer } from './server.js';
import { getFreePort } from './test-helpers/free-port.js';
import { buildSessionConfig, issueSessionJwt } from './auth/session.js';
import { createInMemorySessionStore } from './auth/store.js';

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
});
