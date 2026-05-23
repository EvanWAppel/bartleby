import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createBartlebyServer, type BartlebyServer } from './server.js';
import { getFreePort } from './test-helpers/free-port.js';

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
