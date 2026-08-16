import { describe, expect, it, vi } from 'vitest';

import { CommentsApiError, createComment, listComments, type CommentDto } from './comments';

const comment: CommentDto = {
  id: 'comment-1',
  note_id: 'note/1',
  author_id: 'user-1',
  parent_comment_id: null,
  anchor: 'anchor-json',
  original_quote: 'selected text',
  body: 'Please clarify this.',
  created_at: '2026-08-16T12:00:00.000Z',
  resolved_at: null,
  is_orphaned: false,
};

describe('comments API', () => {
  it('creates a comment and serializes the web input to the wire shape', async () => {
    const fetchMock = vi.fn(async () => Response.json(comment, { status: 201 }));

    const result = await createComment(
      'note/1',
      { anchor: 'anchor-json', originalQuote: 'selected text', body: 'Please clarify this.' },
      { fetch: fetchMock },
    );

    expect(result).toEqual(comment);
    expect(fetchMock).toHaveBeenCalledWith('/notes/note%2F1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        anchor: 'anchor-json',
        original_quote: 'selected text',
        body: 'Please clarify this.',
      }),
    });
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'comment_invalid', message: 'Comment body is required' } },
        { status: 422, statusText: 'Unprocessable Content' },
      ),
    );
    const request = listComments('note-1', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(CommentsApiError);
    await expect(request).rejects.toMatchObject({
      status: 422,
      code: 'comment_invalid',
      message: 'Comment body is required',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response('not-json', { status: 502, statusText: 'Bad Gateway' }),
    );
    const request = listComments('note-1', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(CommentsApiError);
    await expect(request).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
      message: 'Bad Gateway',
    });
  });
});
