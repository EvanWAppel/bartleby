// M-007: retry-with-backoff + permanent-failure logging for mention emails.
//
// `createEmailSender({ transport, logger, retryDelaysMs })` returns a
// `send(payload)` that:
//   - calls `transport.send(payload)` once
//   - on `TransientEmailError` or an unknown thrown value, retries after
//     each of the `retryDelaysMs` in turn (default: 1s, 5s, 30s)
//   - on `PermanentEmailError` (4xx, bad recipient, missing API key),
//     does NOT retry and logs at error level
//   - on exhausted retries, logs at error level and rethrows so the
//     batcher can decide what to do (today: log + continue; the
//     `email_sent_at` column stays NULL so a future scan-and-resend job
//     can find dead-lettered mentions)
//
// The Resend SDK throws a structured error object; the transport
// adapter (`createResendEmailTransport`) is responsible for classifying
// HTTP status into Permanent vs Transient. The sender stays generic so
// it's trivial to unit-test with a vi.fn() mock and so swapping
// providers later doesn't ripple into the retry logic.

import type { Logger } from 'pino';

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransportResult {
  /** Provider-assigned message id (Resend's `data.id`). */
  id: string;
}

export interface EmailTransport {
  send(payload: EmailPayload): Promise<EmailTransportResult>;
}

export class TransientEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientEmailError';
  }
}

export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}

export interface EmailSenderOptions {
  transport: EmailTransport;
  logger: Logger;
  /**
   * Delays (ms) between successive retry attempts. Length determines the
   * maximum retry count. Defaults to [1000, 5000, 30000] (1s, 5s, 30s).
   * Use [] in tests / for fail-fast.
   */
  retryDelaysMs?: number[];
  /** Injectable sleep so vitest fake timers can drive retries. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EmailSender {
  send(payload: EmailPayload): Promise<void>;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createEmailSender(options: EmailSenderOptions): EmailSender {
  const { transport, logger } = options;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;

  async function send(payload: EmailPayload): Promise<void> {
    // 1 initial attempt + len(retryDelaysMs) retries.
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        const result = await transport.send(payload);
        if (attempt > 0) {
          logger.info(
            { to: payload.to, messageId: result.id, attempt: attempt + 1 },
            'mention-email: sent after retry',
          );
        } else {
          logger.debug({ to: payload.to, messageId: result.id }, 'mention-email: sent');
        }
        return;
      } catch (err) {
        lastError = err;
        if (err instanceof PermanentEmailError) {
          logger.error(
            { to: payload.to, error: err.message },
            'mention-email: permanent failure (not retrying)',
          );
          throw err;
        }
        // Transient or unknown: log + retry if we have budget.
        const isLastAttempt = attempt === retryDelaysMs.length;
        if (isLastAttempt) {
          logger.error(
            {
              to: payload.to,
              error: err instanceof Error ? err.message : String(err),
              attempts: attempt + 1,
            },
            'mention-email: retries exhausted',
          );
          throw err;
        }
        const delayMs = retryDelaysMs[attempt]!;
        logger.warn(
          {
            to: payload.to,
            error: err instanceof Error ? err.message : String(err),
            attempt: attempt + 1,
            nextDelayMs: delayMs,
          },
          'mention-email: transient failure, retrying',
        );
        await sleep(delayMs);
      }
    }
    // Unreachable — loop returns or throws on every path. Throw for type
    // narrowing.
    throw lastError ?? new Error('mention-email: unreachable retry state');
  }

  return { send };
}

// ----- Resend transport adapter -----------------------------------------

interface ResendErrorLike {
  statusCode?: number | null;
  message?: string;
  name?: string;
}

interface ResendSendResult {
  // Resend's SDK types use `null` (not undefined) for missing fields,
  // and forbid `undefined` via strict optionality. Keep our adapter
  // shape compatible by allowing both.
  data?: { id?: string } | null;
  error?: ResendErrorLike | null;
}

/** Minimum shape of the `resend` SDK we depend on — keeps the import
 * site tidy and the unit tests free of the real SDK. */
export interface ResendClientLike {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    }): Promise<ResendSendResult>;
  };
}

/** Classify a Resend status code into transient (retry) vs permanent
 * (fail fast). 408 and 429 count as transient so a rate-limit blip is
 * retried with backoff. */
function isPermanentStatus(status: number): boolean {
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

export function createResendEmailTransport(client: ResendClientLike): EmailTransport {
  return {
    async send(payload) {
      let result: ResendSendResult;
      try {
        result = await client.emails.send({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      } catch (err) {
        // The SDK throws on transport-level errors (DNS, TCP reset,
        // timeouts). Treat as transient — fail-fast 4xx errors come back
        // in `result.error` with a status code, not as a throw.
        throw new TransientEmailError(
          `resend transport error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (result.error) {
        const status = result.error.statusCode ?? 500;
        const message = `resend ${status}: ${result.error.message ?? 'unknown error'}`;
        if (isPermanentStatus(status)) {
          throw new PermanentEmailError(message);
        }
        throw new TransientEmailError(message);
      }
      if (!result.data?.id) {
        throw new TransientEmailError('resend: missing data.id in successful response');
      }
      return { id: result.data.id };
    },
  };
}

/** No-op transport used when RESEND_API_KEY is unset (dev, CI). Logs
 * each send at info so it's visible the email pipeline is wired but the
 * provider isn't. */
export function createNoopEmailTransport(logger: Logger): EmailTransport {
  return {
    async send(payload) {
      logger.info(
        { to: payload.to, subject: payload.subject },
        'mention-email: no-op transport (RESEND_API_KEY unset)',
      );
      return { id: `noop-${Date.now()}` };
    },
  };
}

/** Q-003 / test-only: in-memory recording transport. Each `send` appends
 * the payload to an internal log; the log is exposed via a test admin
 * route (gated on ALLOW_TEST_SIGN_IN=true) so an e2e test can assert
 * the email path actually fired without going out over HTTP. */
export interface RecordingEmailTransport extends EmailTransport {
  /** Snapshot of every payload sent (oldest first). */
  recorded(): EmailPayload[];
  /** Drop the recorded log. Useful between test cases. */
  reset(): void;
}

export function createRecordingEmailTransport(logger: Logger): RecordingEmailTransport {
  const log: EmailPayload[] = [];
  let counter = 0;
  return {
    async send(payload) {
      log.push(payload);
      counter += 1;
      logger.debug(
        { to: payload.to, subject: payload.subject, count: counter },
        'mention-email: recording transport captured send',
      );
      return { id: `recording-${counter}` };
    },
    recorded() {
      return [...log];
    },
    reset() {
      log.length = 0;
      counter = 0;
    },
  };
}
