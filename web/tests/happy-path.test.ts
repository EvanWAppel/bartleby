// Q-003: full happy-path end-to-end.
//
// Drives the real auth → notes → comments → mention extraction → email
// batch pipeline in one test, then asserts the email actually fired.
//
// Pipeline overview (for context — none of this is mocked at the
// transport layer):
//   1. signIn helper drives /auth/dev/sign-in (test-only route) to
//      upsert each user and seat a session cookie.
//   2. Create a note (POST /notes), navigate to /n/:id.
//   3. Open the W-018 selection-driven composer on a typed selection
//      and post a comment. The body is "@<recipient> ..." so the M-002
//      comment-mention extractor finds a real user_id and inserts a
//      mentions row.
//   4. The M-005 batcher's `enqueueByMentionId` is fired from the
//      comments route. playwright.config.ts sets
//      MENTION_BATCH_WINDOW_MS=100 so the batcher drains almost
//      immediately instead of waiting 60s.
//   5. We POST to /admin/test/flush-mention-batches to force-drain
//      anything still pending so the assert doesn't race the timer.
//   6. We GET /admin/test/sent-emails and assert exactly one captured
//      payload addressed to the recipient, mentioning the mentioner
//      and the note's deep link.
//
// The recording transport / admin routes are wired by server/src/index.ts
// when ALLOW_TEST_SIGN_IN=true (playwright.config.ts sets it).
//
// We use TWO users so the M-002 self-mention skip doesn't drop the
// notification — alice signs in first so she's in the users table,
// then bob signs in, opens the note, and @-mentions alice.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

interface RecordedEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

async function getSentEmails(request: APIRequestContext): Promise<RecordedEmail[]> {
  const res = await request.get('/admin/test/sent-emails');
  if (!res.ok()) {
    throw new Error(`/admin/test/sent-emails failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { emails: RecordedEmail[] };
  return body.emails;
}

async function flushMentionBatches(request: APIRequestContext): Promise<void> {
  const res = await request.post('/admin/test/flush-mention-batches');
  if (!res.ok()) {
    throw new Error(
      `/admin/test/flush-mention-batches failed: ${res.status()} ${await res.text()}`,
    );
  }
}

async function resetSentEmails(request: APIRequestContext): Promise<void> {
  const res = await request.post('/admin/test/sent-emails/reset');
  if (!res.ok()) {
    throw new Error(`/admin/test/sent-emails/reset failed: ${res.status()} ${await res.text()}`);
  }
}

test('full happy path: sign in, create note, comment, @mention, email sent (Q-003)', async ({
  browser,
}) => {
  // Step 0 — reset the global recording transport before this test.
  // Other tests in the same Playwright run share the same bartleby
  // process, so the email log may already contain mentions from
  // editor-mentions.test.ts etc. We clear at the start and filter on
  // recipient at the assert, which keeps this test order-independent.
  const cleanupCtx = await browser.newContext();
  await resetSentEmails(cleanupCtx.request);
  await cleanupCtx.close();

  // Distinct emails per run so concurrent workers (and previous test
  // runs that reused the bartleby server) don't collide on the users
  // table.
  const runId = Date.now();
  const aliceEmail = `alice-${runId}@example.com`;
  const bobEmail = `bob-${runId}@example.com`;

  // Step 1a — alice signs in so the users table has her row. M-002
  // resolves mentions via `repos.users.findByEmail`; an allowlist-only
  // entry with no users row is silently skipped.
  const aliceCtx = await browser.newContext();
  await signIn(aliceCtx, { email: aliceEmail, displayName: 'Alice' });

  // Step 1b — bob signs in. He owns the note and will author the
  // comment containing the @alice mention.
  const bobCtx = await browser.newContext();
  await signIn(bobCtx, { email: bobEmail, displayName: 'Bob' });

  // Step 2 — bob creates a note and navigates to it.
  const note = await createNote(bobCtx, `q003-${runId}`);
  const page = await bobCtx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();

  // Step 3 — type body text, select it, open the W-018 floating
  // toolbar's composer.
  await page.keyboard.type('please review this paragraph');
  await expect(editor).toContainText('please review this paragraph');
  // Select the trailing word "paragraph" using the same End +
  // Shift+ArrowLeft × N pattern the comments-composer spec test uses
  // (PM's mouse-selection path is flaky under synthetic events).
  await page.keyboard.press('End');
  for (let i = 0; i < 'paragraph'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await expect(page.getByTestId('comment-floating-toolbar')).toBeVisible();
  await page.getByTestId('comment-floating-toolbar-button').click();
  await expect(page.getByTestId('comment-composer')).toBeVisible();

  // Step 4 — type a comment body that @-mentions alice. The
  // mention-trigger plugin only fires at start-of-string or after
  // whitespace; we pad with a leading word so the regex on the server
  // ALSO matches (the M-002 extractor uses the same boundary rule).
  // The composer body input is a plain <textarea>, so we type the
  // literal `@alice@...` string — the picker doesn't run inside it.
  const commentBody = `nudge @${aliceEmail} for thoughts`;
  await page.getByTestId('comment-composer-body').fill(commentBody);
  await page.getByTestId('comment-composer-submit').click();
  await expect(page.getByTestId('comment-composer')).toBeHidden();

  // Sanity: the comment row exists with the expected body. Confirms
  // the comments POST succeeded so a missing email is unambiguously
  // an email-pipeline bug, not a missed comment.
  const commentsRes = await bobCtx.request.get(`/notes/${note.id}/comments`);
  expect(commentsRes.ok()).toBe(true);
  const commentsList = (await commentsRes.json()) as {
    comments: { body: string }[];
  };
  expect(commentsList.comments.some((c) => c.body === commentBody)).toBe(true);

  // Step 5 — drain the batcher. With MENTION_BATCH_WINDOW_MS=100 the
  // timer would fire on its own in a tick or two, but flushing
  // explicitly removes the race.
  await flushMentionBatches(bobCtx.request);

  // Step 6 — assert exactly one email was recorded for alice in this
  // run, with the expected mentioner + deep link.
  const emails = await getSentEmails(bobCtx.request);
  const forAlice = emails.filter((e) => e.to === aliceEmail);
  expect(forAlice).toHaveLength(1);
  const email = forAlice[0]!;
  expect(email.subject).toContain('Bob');
  expect(email.subject).toContain('mentioned you');
  // Deep link points at the note we created. PUBLIC_BASE_URL in tests
  // is http://127.0.0.1:5173 (see playwright.config.ts).
  expect(email.html).toContain(`/n/${encodeURIComponent(note.id)}`);
  expect(email.text).toContain(`/n/${encodeURIComponent(note.id)}`);
  // The mentioner name shows up in both bodies.
  expect(email.text).toContain('Bob');
  // The note title round-trips through the email body.
  expect(email.html).toContain(`q003-${runId}`);

  await aliceCtx.close();
  await bobCtx.close();
});
