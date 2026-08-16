import { describe, expect, it, vi } from 'vitest';

import { createNote, listBacklinks, listNotes, NotesApiError, type NoteSummary } from './notes';

const note: NoteSummary = {
  id: 'note-1',
  title: 'Project notes',
  tags: ['planning'],
  created_at: '2026-08-16T11:00:00.000Z',
  updated_at: '2026-08-16T12:00:00.000Z',
};

describe('notes API', () => {
  it('returns notes and encodes list filters', async () => {
    const fetchMock = vi.fn(async () => Response.json({ notes: [note] }));
    const controller = new AbortController();

    const result = await listNotes({
      tag: 'team notes',
      q: 'alpha/beta',
      signal: controller.signal,
      fetch: fetchMock,
    });

    expect(result).toEqual([note]);
    expect(fetchMock).toHaveBeenCalledWith('/notes?tag=team+notes&q=alpha%2Fbeta', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  });

  it('maps backlink wire fields to the web model', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        backlinks: [
          { source_id: 'source-1', source_title: 'Source note', link_text: 'Project notes' },
        ],
      }),
    );

    const result = await listBacklinks('note/1', { fetch: fetchMock });

    expect(result).toEqual([
      { sourceId: 'source-1', sourceTitle: 'Source note', linkText: 'Project notes' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/notes/note%2F1/backlinks', {
      headers: { accept: 'application/json' },
      signal: undefined,
    });
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'note_invalid', message: 'Title cannot be empty' } },
        { status: 422, statusText: 'Unprocessable Content' },
      ),
    );
    const request = createNote('', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(NotesApiError);
    await expect(request).rejects.toMatchObject({
      status: 422,
      code: 'note_invalid',
      message: 'Title cannot be empty',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response('upstream reset', { status: 502, statusText: 'Bad Gateway' }),
    );
    const request = createNote('Project notes', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(NotesApiError);
    await expect(request).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
      message: 'Bad Gateway',
    });
  });
});
