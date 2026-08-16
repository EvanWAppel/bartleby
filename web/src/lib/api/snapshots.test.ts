import { describe, expect, it, vi } from 'vitest';

import { listSnapshots, SnapshotsApiError, type SnapshotSummary } from './snapshots';

const snapshot: SnapshotSummary = {
  id: 'snapshot-1',
  note_id: 'note/1',
  label: 'Before rewrite',
  created_at: '2026-08-16T12:00:00.000Z',
};

describe('snapshots API', () => {
  it('returns snapshots and encodes pagination parameters', async () => {
    const fetchMock = vi.fn(async () => Response.json({ snapshots: [snapshot] }));

    const result = await listSnapshots('note/1', {
      limit: 25,
      offset: 50,
      fetch: fetchMock,
    });

    expect(result).toEqual([snapshot]);
    expect(fetchMock).toHaveBeenCalledWith('/notes/note%2F1/snapshots?limit=25&offset=50', {
      headers: { accept: 'application/json' },
      signal: undefined,
    });
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'snapshot_missing', message: 'Snapshot not found' } },
        { status: 404, statusText: 'Not Found' },
      ),
    );
    const request = listSnapshots('note-1', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(SnapshotsApiError);
    await expect(request).rejects.toMatchObject({
      status: 404,
      code: 'snapshot_missing',
      message: 'Snapshot not found',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response('proxy error', { status: 502, statusText: 'Bad Gateway' }),
    );
    const request = listSnapshots('note-1', { fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(SnapshotsApiError);
    await expect(request).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
      message: 'Bad Gateway',
    });
  });
});
