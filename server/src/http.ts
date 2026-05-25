// HTTP server composition. Mounts the auth routes (Workstream A) + the
// notes REST API (Workstream S) onto a hono root and wraps it with
// @hono/node-server for production use.
//
// The Hocuspocus WebSocket server (server.ts) currently runs on its own
// port; A-010 will fold WS auth in. Keeping the HTTP and WS servers
// separate for now is the simplest thing that works.

import type { Database } from 'better-sqlite3';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import {
  buildSessionConfig,
  createAuthApp,
  createGoogleClient,
  createInMemorySessionStore,
  loadAllowlist,
  loadGoogleConfig,
  requireSession,
  type AuthVars,
  type SessionStore,
} from './auth/index.js';
import { createRepositories } from './db/repositories/index.js';
import { errorHandler } from './http/errors.js';
import { requestLogger } from './http/logging.js';
import { createNotesApp } from './notes/routes.js';

export interface BartlebyHttpServer {
  readonly port: number;
  readonly store: SessionStore;
  readonly app: Hono<{ Variables: AuthVars }>;
  close(): Promise<void>;
}

export interface BartlebyHttpOptions {
  port: number;
  env: Record<string, string | undefined>;
  db: Database;
  logger: Logger;
}

export interface BuildHttpAppDeps {
  db: Database;
  logger: Logger;
}

export function buildBartlebyHttpApp(
  env: Record<string, string | undefined>,
  deps: BuildHttpAppDeps,
): {
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
  const repos = createRepositories(deps.db);

  const root = new Hono<{ Variables: AuthVars }>();
  // Order matters: error handler wraps everything; request logger sees
  // the final status set by handlers; auth gating fires before notes
  // handlers run so c.get('user') is populated.
  root.onError(errorHandler({ logger: deps.logger }));
  root.use('*', requestLogger(deps.logger));

  const auth = createAuthApp({
    sessionConfig,
    store,
    allowlist,
    google,
    appConfig: { publicBaseUrl },
  });
  root.route('/', auth);

  // S routes — gated by requireSession.
  root.use('/notes/*', requireSession({ sessionConfig, store }));
  const notes = createNotesApp({ repos });
  root.route('/', notes);

  return { app: root, store };
}

export function createBartlebyHttpServer(
  options: BartlebyHttpOptions,
): Promise<BartlebyHttpServer> {
  const { app, store } = buildBartlebyHttpApp(options.env, {
    db: options.db,
    logger: options.logger,
  });
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
