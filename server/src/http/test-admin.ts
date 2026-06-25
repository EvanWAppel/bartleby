// Q-003: test-only admin routes for inspecting + driving the mention
// email pipeline from e2e tests. Mounted ONLY when ALLOW_TEST_SIGN_IN
// is true (http.ts enforces the gate) and ONLY when the caller wires
// the corresponding hooks.
//
//   GET  /admin/test/sent-emails             returns every payload the
//                                            recording transport saw,
//                                            oldest first
//   POST /admin/test/sent-emails/reset       clears the recorded log
//   POST /admin/test/flush-mention-batches   immediately drains every
//                                            pending M-005 batch and
//                                            waits for the sends to
//                                            settle — short-circuits
//                                            the 60s sliding window so
//                                            e2e tests don't have to
//                                            sleep
//
// These routes are deliberately mounted under /admin/test/ so a quick
// grep can spot them; production deployments must never set
// ALLOW_TEST_SIGN_IN, which also disables the dev sign-in route.

import { Hono } from 'hono';
import type { RecordingEmailTransport } from '../mentions/email-sender.js';

export interface TestAdminAppDeps {
  recorder?: RecordingEmailTransport;
  flushMentionBatches?: () => Promise<void>;
}

export function createTestAdminApp(deps: TestAdminAppDeps): Hono {
  const app = new Hono();

  app.get('/admin/test/sent-emails', (c) => {
    if (deps.recorder === undefined) {
      return c.json(
        {
          error: {
            code: 'not_configured',
            message: 'recording transport not wired (ALLOW_TEST_SIGN_IN set but no recorder)',
          },
        },
        503,
      );
    }
    return c.json({ emails: deps.recorder.recorded() });
  });

  app.post('/admin/test/sent-emails/reset', (c) => {
    if (deps.recorder === undefined) {
      return c.json(
        { error: { code: 'not_configured', message: 'recording transport not wired' } },
        503,
      );
    }
    deps.recorder.reset();
    return c.body(null, 204);
  });

  app.post('/admin/test/flush-mention-batches', async (c) => {
    if (deps.flushMentionBatches === undefined) {
      return c.json(
        { error: { code: 'not_configured', message: 'mention pipeline flush not wired' } },
        503,
      );
    }
    await deps.flushMentionBatches();
    return c.body(null, 204);
  });

  return app;
}
