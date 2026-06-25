// M-007: retry-with-backoff + permanent-failure logging for mention emails.
//
// The sender wraps an injected `EmailTransport` (the production transport
// is the Resend SDK; tests use a mock). Behaviour under test:
//   - happy path: one call, no retry
//   - transient 5xx / network error: retried up to N times, then succeeds
//   - permanent 4xx: NOT retried; logged as an error
//   - exhausted retries: logged as an error and rejects (the batcher
//     catches and continues)
//
// Backoff timing is parameterized via `retryDelaysMs` so tests can use
// instant delays without `vi.useFakeTimers()`.

import { describe, expect, test, vi } from 'vitest';
import pino from 'pino';
import {
  createEmailSender,
  PermanentEmailError,
  TransientEmailError,
  type EmailTransport,
  type EmailPayload,
} from './email-sender.js';

const SILENT_LOGGER = pino({ level: 'silent' });

const PAYLOAD: EmailPayload = {
  to: 'alice@example.com',
  from: 'mentions@bartleby.example',
  subject: 'Bob mentioned you',
  html: '<p>hi</p>',
  text: 'hi',
};

describe('createEmailSender (M-007)', () => {
  test('happy path: single send, no retries', async () => {
    const send = vi.fn<EmailTransport['send']>().mockResolvedValue({ id: 'msg-1' });
    const sender = createEmailSender({
      transport: { send },
      logger: SILENT_LOGGER,
      retryDelaysMs: [],
    });
    await sender.send(PAYLOAD);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('retries on transient 5xx, eventually succeeds', async () => {
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValueOnce(new TransientEmailError('500: server error'))
      .mockRejectedValueOnce(new TransientEmailError('502: gateway'))
      .mockResolvedValueOnce({ id: 'msg-2' });
    const sender = createEmailSender({
      transport: { send },
      logger: SILENT_LOGGER,
      retryDelaysMs: [1, 1, 1],
    });
    await sender.send(PAYLOAD);
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('does NOT retry on permanent 4xx', async () => {
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValue(new PermanentEmailError('400: invalid recipient'));
    const errorSpy = vi.fn();
    const logger = pino({ level: 'silent' });
    logger.error = errorSpy as never;
    const sender = createEmailSender({
      transport: { send },
      logger,
      retryDelaysMs: [1, 1, 1],
    });
    await expect(sender.send(PAYLOAD)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('exhausts retries on persistent 5xx and logs the failure', async () => {
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValue(new TransientEmailError('503: still down'));
    const errorSpy = vi.fn();
    const logger = pino({ level: 'silent' });
    logger.error = errorSpy as never;
    const sender = createEmailSender({
      transport: { send },
      logger,
      retryDelaysMs: [1, 1, 1],
    });
    await expect(sender.send(PAYLOAD)).rejects.toBeInstanceOf(TransientEmailError);
    // 1 initial attempt + 3 retries.
    expect(send).toHaveBeenCalledTimes(4);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('unknown errors are treated as transient (defensive)', async () => {
    // Network errors (TCP reset, DNS failure) from Resend won't carry
    // a 4xx/5xx tag — by default treat them as retryable so a flaky
    // network doesn't drop notifications.
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ id: 'msg-3' });
    const sender = createEmailSender({
      transport: { send },
      logger: SILENT_LOGGER,
      retryDelaysMs: [1],
    });
    await sender.send(PAYLOAD);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
