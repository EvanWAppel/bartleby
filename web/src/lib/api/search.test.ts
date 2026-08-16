import { describe, expect, it, vi } from 'vitest';

import { parseSnippet, searchNotes, SearchApiError, type SearchHit } from './search';

const hit: SearchHit = {
  id: 'note-1',
  title: 'Project notes',
  snippet: 'the <mark>matching</mark> text',
};

describe('search API', () => {
  it('returns hits and encodes the query and limit', async () => {
    const fetchMock = vi.fn(async () => Response.json({ hits: [hit] }));

    const result = await searchNotes('alpha/beta', { limit: 12, fetch: fetchMock });

    expect(result).toEqual([hit]);
    expect(fetchMock).toHaveBeenCalledWith('/search?q=alpha%2Fbeta&limit=12', {
      headers: { accept: 'application/json' },
      signal: undefined,
    });
  });

  it('parses only balanced mark pairs into highlighted segments', () => {
    expect(parseSnippet('before <mark>match</mark> after <mark>unfinished')).toEqual([
      { text: 'before ', highlighted: false },
      { text: 'match', highlighted: true },
      { text: ' after <mark>unfinished', highlighted: false },
    ]);
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'search_invalid', message: 'Query is required' } },
        { status: 400, statusText: 'Bad Request' },
      ),
    );
    const request = searchNotes('', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(SearchApiError);
    await expect(request).rejects.toMatchObject({
      status: 400,
      code: 'search_invalid',
      message: 'Query is required',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response('not-json', { status: 500, statusText: 'Internal Server Error' }),
    );
    const request = searchNotes('project', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(SearchApiError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: 'unknown',
      message: 'Internal Server Error',
    });
  });
});
