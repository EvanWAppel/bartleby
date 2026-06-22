// W-019 / C-002..C-006: typed wrapper over the snapshots REST API.
//
// List endpoints return SnapshotSummary (no body bytes, no markdown).
// Detail endpoint includes `markdown_preview` so the preview pane can
// render without pulling in Yjs on the client.

export interface SnapshotSummary {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
}

export interface SnapshotDetail extends SnapshotSummary {
  yjs_state_base64: string;
  markdown_preview: string;
}

export class SnapshotsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'SnapshotsApiError';
  }
}

type FetchLike = typeof fetch;

async function parseError(res: Response): Promise<SnapshotsApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new SnapshotsApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new SnapshotsApiError(res.status, 'unknown', res.statusText);
  }
}

export async function listSnapshots(
  noteId: string,
  opts: { limit?: number; offset?: number; signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<SnapshotSummary[]> {
  const f = opts.fetch ?? fetch;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const res = await f(`/notes/${encodeURIComponent(noteId)}/snapshots${qs}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { snapshots: SnapshotSummary[] };
  return body.snapshots;
}

export async function getSnapshot(
  noteId: string,
  snapId: string,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<SnapshotDetail> {
  const f = opts.fetch ?? fetch;
  const res = await f(
    `/notes/${encodeURIComponent(noteId)}/snapshots/${encodeURIComponent(snapId)}`,
    {
      headers: { accept: 'application/json' },
      signal: opts.signal,
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as SnapshotDetail;
}

export async function createNamedSnapshot(
  noteId: string,
  label: string,
  opts: { fetch?: FetchLike } = {},
): Promise<SnapshotSummary> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(noteId)}/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as SnapshotSummary;
}

export async function restoreSnapshot(
  noteId: string,
  snapId: string,
  opts: { fetch?: FetchLike } = {},
): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(
    `/notes/${encodeURIComponent(noteId)}/snapshots/${encodeURIComponent(snapId)}/restore`,
    { method: 'POST' },
  );
  if (!res.ok) throw await parseError(res);
}
