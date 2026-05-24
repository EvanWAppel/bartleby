import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createBartlebyServer, type BartlebyServer } from './server.js';
import { getFreePort } from './test-helpers/free-port.js';

describe('Hocuspocus persistence (V-010)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bartleby-test-'));
    dbPath = join(tmpDir, 'bartleby.db');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persists Yjs state across server restarts', async () => {
    const port = await getFreePort();
    const roomName = 'persistence-room';

    // Round 1: start server, write text, shut down.
    {
      const server: BartlebyServer = await createBartlebyServer({
        port,
        databasePath: dbPath,
      });
      try {
        const writerDoc = new Y.Doc();
        const writer = new HocuspocusProvider({
          url: `ws://127.0.0.1:${port}`,
          name: roomName,
          document: writerDoc,
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('writer sync timeout')), 5000);
          writer.on('synced', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        writerDoc.getText('body').insert(0, 'persisted hello');
        // Wait long enough for the SQLite extension's debounced write to
        // flush to disk. Hocuspocus debounces by default at ~2s.
        await new Promise((r) => setTimeout(r, 3500));
        writer.destroy();
      } finally {
        await server.destroy();
      }
    }

    // Round 2: same DB path, same room, fresh reader.
    {
      const server: BartlebyServer = await createBartlebyServer({
        port,
        databasePath: dbPath,
      });
      try {
        const readerDoc = new Y.Doc();
        const reader = new HocuspocusProvider({
          url: `ws://127.0.0.1:${port}`,
          name: roomName,
          document: readerDoc,
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('reader sync timeout')), 5000);
          reader.on('synced', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        expect(readerDoc.getText('body').toString()).toBe('persisted hello');
        reader.destroy();
      } finally {
        await server.destroy();
      }
    }
  }, 30_000);
});
