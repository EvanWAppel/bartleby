// Bartleby server entrypoint. Boots:
//   - Hocuspocus WebSocket server (collab traffic; auth on WS lands in A-010)
//   - HTTP server with the auth routes (Workstream A)
// after validating env config and running pending migrations (Workstream D).

import { Resend } from 'resend';
import { loadConfig } from './config.js';
import { openDatabase } from './db/open.js';
import { createRepositories } from './db/repositories/index.js';
import { createDerivedStateHook } from './derived/hook.js';
import { createLogger } from './logger.js';
import {
  createNoopEmailTransport,
  createRecordingEmailTransport,
  createResendEmailTransport,
  type EmailTransport,
  type RecordingEmailTransport,
} from './mentions/email-sender.js';
import { createMentionEmailPipeline } from './mentions/pipeline.js';
import { runMigrations } from './migrate.js';
import { createTrashPurger } from './notes/purge.js';
import { createBartlebyServer } from './server.js';
import { createBartlebyHttpServer } from './http.js';
import { createAutoSnapshotScheduler } from './snapshots/scheduler.js';
import { createHocuspocusAccessor } from './snapshots/yjs-access.js';
import { buildSessionConfig, createInMemorySessionStore } from './auth/index.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  // 1. Validate env. Throws + exits if a required var is missing or a
  //    value violates its schema.
  const config = loadConfig();

  // 2. Structured logger from validated config.
  const logger = createLogger(config.LOG_LEVEL);

  logger.info(
    {
      wsPort: config.PORT,
      httpPort: config.HTTP_PORT,
      bind: config.BARTLEBY_BIND_ADDRESS,
      databasePath: config.BARTLEBY_DB_PATH,
    },
    'starting bartleby',
  );

  // 3. Open the long-lived DB connection FIRST, then apply migrations
  //    against the same handle. This matters for `:memory:` paths
  //    (every :memory: connection is a fresh database, so applying
  //    migrations on a separate connection would leave the runtime
  //    handle with an empty schema). Hocuspocus's SQLite extension
  //    opens its own connection to the same path — WAL mode handles
  //    the concurrent readers + one writer per process.
  const db = openDatabase(config.BARTLEBY_DB_PATH);
  await runMigrations({ db, logger });
  const repos = createRepositories(db);
  const authEnabled = config.PUBLIC_BASE_URL !== undefined && config.PUBLIC_BASE_URL.length > 0;
  const sharedSessionStore = authEnabled ? createInMemorySessionStore() : undefined;
  const sharedSessionConfig = authEnabled ? buildSessionConfig(process.env) : undefined;

  // 4a. M-005/M-006/M-007 mention-email pipeline. Resend is the
  //     provider. When RESEND_API_KEY is unset we wire a no-op
  //     transport that logs every "send" — keeps the rest of the
  //     pipeline live in local dev / CI without making outbound HTTP.
  //     PUBLIC_BASE_URL is required for the deep links in the email
  //     body; without it we also fall back to no-op (template would
  //     produce invalid URLs).
  let mentionPipeline: ReturnType<typeof createMentionEmailPipeline> | undefined;
  // Q-003: when ALLOW_TEST_SIGN_IN is on, swap in a recording transport
  // so the test admin route can read the captured payloads. The handle
  // is also exposed to the HTTP layer below.
  let recordingTransport: RecordingEmailTransport | undefined;
  if (config.PUBLIC_BASE_URL !== undefined && config.PUBLIC_BASE_URL.length > 0) {
    let transport: EmailTransport;
    if (process.env.ALLOW_TEST_SIGN_IN === 'true') {
      recordingTransport = createRecordingEmailTransport(logger);
      transport = recordingTransport;
      logger.warn(
        'mention-email: ALLOW_TEST_SIGN_IN=true — using recording transport (Q-003 test mode)',
      );
    } else if (config.RESEND_API_KEY !== undefined && config.RESEND_API_KEY.length > 0) {
      transport = createResendEmailTransport(new Resend(config.RESEND_API_KEY));
      logger.info('mention-email: Resend transport active');
    } else {
      transport = createNoopEmailTransport(logger);
      logger.warn(
        'mention-email: RESEND_API_KEY unset — using no-op transport (emails will be logged, not sent)',
      );
    }
    mentionPipeline = createMentionEmailPipeline({
      repos,
      logger,
      transport,
      publicBaseUrl: config.PUBLIC_BASE_URL,
      // Resend's verified-domain default — operators override via
      // BARTLEBY_EMAIL_FROM if they need a vanity address. Keeping the
      // env var out of config.ts for now so M-001..M-004's already-
      // shipped config schema stays untouched; we only read it here.
      fromAddress: process.env.BARTLEBY_EMAIL_FROM ?? 'Bartleby <onboarding@resend.dev>',
      // Q-003: env override (validated as positive int by config.ts) so
      // e2e tests can collapse the 60s batching window without touching
      // production semantics.
      windowMs: config.MENTION_BATCH_WINDOW_MS,
    });
  } else {
    logger.warn(
      'mention-email: PUBLIC_BASE_URL unset — mention emails disabled (deep links would be invalid)',
    );
  }

  // 4. Boot the WS server with the derived-state hook attached. The
  //    hook fires on Hocuspocus's debounced WAL flush and keeps
  //    notes.markdown_export + tags + backlinks in sync with the live
  //    CRDT — see src/derived/hook.ts.
  const derivedHook = createDerivedStateHook({
    repos,
    logger,
    onMentionInserted:
      mentionPipeline !== undefined ? (id) => mentionPipeline!.enqueueByMentionId(id) : undefined,
  });
  const ws = await createBartlebyServer({
    port: config.PORT,
    databasePath: config.BARTLEBY_DB_PATH,
    address: config.BARTLEBY_BIND_ADDRESS,
    extraExtensions: [derivedHook],
    auth:
      sharedSessionConfig !== undefined && sharedSessionStore !== undefined
        ? { sessionConfig: sharedSessionConfig, store: sharedSessionStore }
        : undefined,
  });

  // 5. Hourly trash purge. Hard-deletes notes whose trashed_at is
  //    older than 30 days (PRD §9.3) + cascades dependent rows via
  //    FKs. Runs in the background; timer is unref()'d so it doesn't
  //    block shutdown.
  const purger = createTrashPurger({ repos, logger });
  purger.start();

  // 5b. C-002 auto-snapshot scheduler. Walks active notes every ~5 min;
  //     for each note whose updated_at is newer than its latest
  //     snapshot, encodes the current Yjs state and writes an
  //     unlabeled snapshot row. C-005 retention is enforced in the
  //     same tick. Timer is unref()'d (set inside the scheduler) so
  //     it doesn't block shutdown.
  const snapshotScheduler = createAutoSnapshotScheduler({
    repos,
    yjs: createHocuspocusAccessor(ws.hocuspocus),
    logger,
  });
  snapshotScheduler.start();

  // 6. Boot the auth + notes HTTP server only if PUBLIC_BASE_URL is
  //    set — createBartlebyHttpServer needs it to build OAuth redirect
  //    URIs and downstream auth helpers also need
  //    BARTLEBY_ALLOWED_EMAILS / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
  //    Local dev and integ tests can run with just the WS server.
  let http: Awaited<ReturnType<typeof createBartlebyHttpServer>> | undefined;
  if (authEnabled) {
    http = await createBartlebyHttpServer({
      port: config.HTTP_PORT,
      env: process.env,
      db,
      logger,
      store: sharedSessionStore,
      hocuspocus: ws.hocuspocus,
      onMentionInserted:
        mentionPipeline !== undefined ? (id) => mentionPipeline!.enqueueByMentionId(id) : undefined,
      // Q-003: hand the test admin route (only mounted when
      // ALLOW_TEST_SIGN_IN=true) the recording transport + a way to
      // force-drain the batcher between assertions.
      testEmailRecorder: recordingTransport,
      flushMentionBatches:
        mentionPipeline !== undefined ? () => mentionPipeline!.flushAll() : undefined,
    });
    logger.info(
      {
        ws: `ws://${config.BARTLEBY_BIND_ADDRESS}:${ws.port}`,
        http: `http://127.0.0.1:${http.port}`,
      },
      'bartleby listening (ws + http)',
    );
  } else {
    logger.warn(
      { ws: `ws://${config.BARTLEBY_BIND_ADDRESS}:${ws.port}` },
      'bartleby listening (ws only; PUBLIC_BASE_URL unset, HTTP/auth skipped)',
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    purger.stop();
    snapshotScheduler.stop();
    // M-005: drain in-flight mention batches BEFORE we tear down the
    // HTTP server / DB so the email sender can still mark
    // email_sent_at on the rows it fires.
    if (mentionPipeline !== undefined) {
      try {
        await mentionPipeline.flushAll();
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          'mention-email: flushAll failed during shutdown',
        );
      }
    }
    if (http !== undefined) {
      await http.close();
    }
    await ws.destroy();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    // Surface validation errors as a clean stderr message + non-zero
    // exit. Stack trace would be noise for env-config problems.
    if (err instanceof Error) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(`${String(err)}\n`);
    }
    process.exit(1);
  });
}
