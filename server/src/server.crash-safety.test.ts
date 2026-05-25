// O-010: prove the server can be SIGKILLed mid-write and the SQLite
// state is recoverable on restart. We can't SIGKILL in-process tests,
// so the server runs as a child process for this one.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { getFreePort } from './test-helpers/free-port.js';

const SERVER_ROOT = resolve(__dirname, '..');

interface SpawnedServer {
  process: ChildProcess;
  port: number;
}

async function waitForHealthy(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on :${port} did not become healthy within ${timeoutMs}ms`);
}

async function spawnServer(databasePath: string, port: number): Promise<SpawnedServer> {
  const process = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: SERVER_ROOT,
    env: {
      ...globalThis.process.env,
      PORT: String(port),
      BARTLEBY_BIND_ADDRESS: '127.0.0.1',
      BARTLEBY_DB_PATH: databasePath,
      LOG_LEVEL: 'warn',
      NPM_CONFIG_CACHE: '/tmp/bartleby-npm-cache',
    },
    stdio: 'ignore',
  });
  await waitForHealthy(port);
  return { process, port };
}

async function syncedProvider(
  port: number,
  room: string,
): Promise<{
  provider: HocuspocusProvider;
  doc: Y.Doc;
}> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: room,
    document: doc,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync timeout')), 5000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { provider, doc };
}

describe('crash-safety (O-010)', () => {
  let tmpDir: string;
  let dbPath: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bartleby-crash-'));
    dbPath = join(tmpDir, 'bartleby.db');
    port = await getFreePort();
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('survives a SIGKILL mid-edit and resumes after restart', async () => {
    const roomName = 'crash-safety-room';

    // Round 1: spawn server, write data, wait for the SQLite debounce
    // window to flush, then SIGKILL — no clean shutdown.
    let first: SpawnedServer | undefined;
    try {
      first = await spawnServer(dbPath, port);

      const { provider, doc } = await syncedProvider(port, roomName);
      doc.getText('body').insert(0, 'crash-safe hello');
      // Hocuspocus default debounce is 2s; give it 3.5s like the
      // persistence test does.
      await new Promise((r) => setTimeout(r, 3500));
      provider.destroy();

      first.process.kill('SIGKILL');
      await new Promise((r) => first!.process.once('exit', r));
    } finally {
      // Defensive: if the SIGKILL above raced with a normal exit,
      // make sure no stray process remains.
      first?.process.kill('SIGKILL');
    }

    // Round 2: same DB path, new server process, new client.
    let second: SpawnedServer | undefined;
    try {
      second = await spawnServer(dbPath, port);

      const { provider: reader, doc: readerDoc } = await syncedProvider(port, roomName);

      expect(readerDoc.getText('body').toString()).toBe('crash-safe hello');
      reader.destroy();
    } finally {
      if (second) {
        second.process.kill('SIGTERM');
        await new Promise((r) => second!.process.once('exit', r));
      }
    }
  }, 30_000);
});
