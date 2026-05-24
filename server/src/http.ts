// HTTP server composition. Mounts the auth routes onto a hono app and
// wraps it with @hono/node-server for production use.
//
// The Hocuspocus WebSocket server (server.ts) currently runs on its own
// port; A-010 will fold WS auth in. Keeping the HTTP and WS servers
// separate for now is the simplest thing that works.

import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import {
  buildSessionConfig,
  createAuthApp,
  createGoogleClient,
  createInMemorySessionStore,
  loadAllowlist,
  loadGoogleConfig,
  type AuthVars,
  type SessionStore,
} from './auth/index.js';

export interface BartlebyHttpServer {
  readonly port: number;
  readonly store: SessionStore;
  readonly app: Hono<{ Variables: AuthVars }>;
  close(): Promise<void>;
}

export interface BartlebyHttpOptions {
  port: number;
  env: Record<string, string | undefined>;
}

export function buildBartlebyHttpApp(env: Record<string, string | undefined>): {
  app: Hono<{ Variables: AuthVars }>;
  store: SessionStore;
} {
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  if (publicBaseUrl === undefined || publicBaseUrl.length === 0) {
    throw new Error(
      'PUBLIC_BASE_URL is required (e.g. http://localhost:3000). Used to build OAuth redirect URIs.',
    );
  }
  const sessionConfig = buildSessionConfig(env);
  const allowlist = loadAllowlist(env);
  const googleConfig = loadGoogleConfig(env);
  const store = createInMemorySessionStore();
  const google = createGoogleClient(googleConfig);

  const root = new Hono<{ Variables: AuthVars }>();
  const auth = createAuthApp({
    sessionConfig,
    store,
    allowlist,
    google,
    appConfig: { publicBaseUrl },
  });
  root.route('/', auth);
  return { app: root, store };
}

export function createBartlebyHttpServer(
  options: BartlebyHttpOptions,
): Promise<BartlebyHttpServer> {
  const { app, store } = buildBartlebyHttpApp(options.env);
  return new Promise((resolve) => {
    const server: ServerType = serve(
      { fetch: app.fetch, port: options.port, hostname: '127.0.0.1' },
      () => {
        resolve({
          port: options.port,
          store,
          app,
          close() {
            return new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            });
          },
        });
      },
    );
  });
}
