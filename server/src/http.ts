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
import type { Hocuspocus } from '@hocuspocus/server';
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
import { createDevAuthApp } from './auth/dev-routes.js';
import { createTestAdminApp } from './http/test-admin.js';
import type { RecordingEmailTransport } from './mentions/email-sender.js';
import { createCommentsApp } from './comments/routes.js';
import { createExportApp } from './export/routes.js';
import { createImportApp } from './import/routes.js';
import { createMentionsApp } from './mentions/routes.js';
import { createNotesApp } from './notes/routes.js';
import { createSearchApp } from './notes/search-route.js';
import { createSnapshotsApp } from './snapshots/routes.js';
import { createHocuspocusAccessor, type YjsDocAccessor } from './snapshots/yjs-access.js';
import { createUsersApp } from './users/routes.js';

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
  /** Optional shared store; A-010 passes this to both HTTP and WS auth. */
  store?: SessionStore;
  /** Optional: when present, mounts the C-002..C-006 snapshot routes. */
  hocuspocus?: Hocuspocus;
  /** See `BuildHttpAppDeps.onMentionInserted`. */
  onMentionInserted?: (mentionId: string) => void;
  /** Q-003: see `BuildHttpAppDeps.testEmailRecorder`. */
  testEmailRecorder?: RecordingEmailTransport;
  /** Q-003: see `BuildHttpAppDeps.flushMentionBatches`. */
  flushMentionBatches?: () => Promise<void>;
}

export interface BuildHttpAppDeps {
  db: Database;
  logger: Logger;
  store?: SessionStore;
  /** Optional Yjs accessor for snapshot endpoints (C-002..C-006).
   * Tests that don't exercise snapshots can omit this; the snapshot
   * routes get mounted only when an accessor is supplied. */
  yjs?: YjsDocAccessor;
  /**
   * M-005: fire-and-forget callback invoked when a new mention row is
   * inserted by the comments route. Wired to the email pipeline in
   * production (index.ts); tests omit it and the email path becomes a
   * no-op.
   */
  onMentionInserted?: (mentionId: string) => void;
  /**
   * Q-003: when supplied AND ALLOW_TEST_SIGN_IN=true, mounts a
   * `GET /admin/test/sent-emails` route that returns the captured
   * Resend payloads. Never wired in production.
   */
  testEmailRecorder?: RecordingEmailTransport;
  /**
   * Q-003: when supplied AND ALLOW_TEST_SIGN_IN=true, mounts a
   * `POST /admin/test/flush-mention-batches` route that drains every
   * pending mention-email batch immediately (bypassing the 60s sliding
   * window). Tests call this right before asserting on
   * /admin/test/sent-emails so they don't have to expect.poll for the
   * batcher timer.
   */
  flushMentionBatches?: () => Promise<void>;
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
  const store = deps.store ?? createInMemorySessionStore();
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
    repos,
  });
  root.route('/', auth);

  // Test-only auth bypass — disabled by default; enabled in Playwright
  // + local dev via ALLOW_TEST_SIGN_IN=true. Mounting it after the real
  // auth routes means it's discoverable at the same /auth/* prefix the
  // Vite proxy already covers.
  if (env.ALLOW_TEST_SIGN_IN === 'true') {
    const devAuth = createDevAuthApp({ sessionConfig, store, repos });
    root.route('/', devAuth);
    deps.logger.warn(
      'ALLOW_TEST_SIGN_IN=true — /auth/dev/sign-in is mounted. Never enable this in production.',
    );
    // Q-003: same env gate — mount the test admin endpoints if the
    // caller wired the recording transport / flush hook.
    if (deps.testEmailRecorder !== undefined || deps.flushMentionBatches !== undefined) {
      const admin = createTestAdminApp({
        recorder: deps.testEmailRecorder,
        flushMentionBatches: deps.flushMentionBatches,
      });
      root.route('/', admin);
      deps.logger.warn(
        'ALLOW_TEST_SIGN_IN=true — /admin/test/* routes mounted (Q-003). Never enable in production.',
      );
    }
  }

  // S routes — gated by requireSession.
  const auth_gate = requireSession({ sessionConfig, store });
  root.use('/notes/*', auth_gate);
  root.use('/search', auth_gate);
  // W-013 users endpoint: feeds the @mention picker. Gated like the
  // notes routes so unauthenticated callers can't enumerate the friends
  // list.
  root.use('/users', auth_gate);
  // C-007 comments endpoints (both /notes/:id/comments and /comments/:id/*).
  root.use('/comments/*', auth_gate);
  // M-003/M-004 mentions endpoints.
  root.use('/mentions', auth_gate);
  root.use('/mentions/*', auth_gate);
  // I-005 export-all endpoint (single-note export sits under /notes/*
  // and is already gated above).
  root.use('/export/*', auth_gate);
  // I-003 import endpoint. Mounted BEFORE the dynamic /notes/:id
  // routes so the static `/notes/import` path wins. Requires the yjs
  // accessor to seed initial Yjs state for each imported note;
  // skipped entirely when no accessor is provided (tests that don't
  // exercise Hocuspocus omit it).
  if (deps.yjs !== undefined) {
    const imp = createImportApp({ repos, yjs: deps.yjs });
    root.route('/', imp);
  }
  const notes = createNotesApp({ repos });
  root.route('/', notes);
  const search = createSearchApp({ repos });
  root.route('/', search);
  const users = createUsersApp({ allowlist, store });
  root.route('/', users);
  const comments = createCommentsApp({
    repos,
    yjs: deps.yjs,
    onMentionInserted: deps.onMentionInserted,
  });
  root.route('/', comments);
  const mentions = createMentionsApp({ repos });
  root.route('/', mentions);
  const exportApp = createExportApp({ repos });
  root.route('/', exportApp);
  if (deps.yjs !== undefined) {
    const snapshots = createSnapshotsApp({ repos, yjs: deps.yjs });
    root.route('/', snapshots);
  }

  return { app: root, store };
}

export function createBartlebyHttpServer(
  options: BartlebyHttpOptions,
): Promise<BartlebyHttpServer> {
  const yjs =
    options.hocuspocus !== undefined ? createHocuspocusAccessor(options.hocuspocus) : undefined;
  const { app, store } = buildBartlebyHttpApp(options.env, {
    db: options.db,
    logger: options.logger,
    store: options.store,
    yjs,
    onMentionInserted: options.onMentionInserted,
    testEmailRecorder: options.testEmailRecorder,
    flushMentionBatches: options.flushMentionBatches,
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
