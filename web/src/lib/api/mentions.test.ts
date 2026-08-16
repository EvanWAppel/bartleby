import { describe, expect, it, vi } from 'vitest';

import { listMentions, MentionsApiError, type MentionDto } from './mentions';

const mention: MentionDto = {
  id: 'mention-1',
  note_id: 'note-1',
  mentioned_user_id: 'user-1',
  mentioning_user_id: 'user-2',
  source: 'note:note-1',
  created_at: '2026-08-16T12:00:00.000Z',
  read_at: null,
  email_sent_at: null,
  note_title: 'Project notes',
};

describe('mentions API', () => {
  it('returns unread mentions and forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => Response.json({ mentions: [mention] }));
    const controller = new AbortController();

    const result = await listMentions({
      unread: true,
      signal: controller.signal,
      fetch: fetchMock,
    });

    expect(result).toEqual([mention]);
    expect(fetchMock).toHaveBeenCalledWith('/mentions?unread=true', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'mention_forbidden', message: 'Mention belongs to another user' } },
        { status: 403, statusText: 'Forbidden' },
      ),
    );
    const request = listMentions({ fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(MentionsApiError);
    await expect(request).rejects.toMatchObject({
      status: 403,
      code: 'mention_forbidden',
      message: 'Mention belongs to another user',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<html>offline</html>', { status: 503, statusText: 'Service Unavailable' }),
    );
    const request = listMentions({ fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(MentionsApiError);
    await expect(request).rejects.toMatchObject({
      status: 503,
      code: 'unknown',
      message: 'Service Unavailable',
    });
  });
});
