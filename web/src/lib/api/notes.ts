// Typed wrapper over the bartleby `/notes` REST API. All requests go
// through the SvelteKit-side proxy (configured in vite.config.ts) so
// the browser sees a same-origin URL.

export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  updated_at: string;
  created_at: string;
}

export interface NotesListResponse {
  notes: NoteSummary[];
}

export interface CreateNoteResponse {
  id: string;
  title: string;
}

export class NotesApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'NotesApiError';
  }
}

async function parseError(res: Response): Promise<NotesApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new NotesApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new NotesApiError(res.status, 'unknown', res.statusText);
  }
}

// All API functions take an optional `fetch` impl so SvelteKit's
// load functions can pass their SSR-aware `fetch` and the browser
// can default to the global. Same shape as svelte/kit conventions.
type FetchLike = typeof fetch;

export interface ListNotesOptions {
  tag?: string;
  q?: string;
  signal?: AbortSignal;
  fetch?: FetchLike;
}

export async function listNotes(opts: ListNotesOptions = {}): Promise<NoteSummary[]> {
  const params = new URLSearchParams();
  if (opts.tag !== undefined) params.set('tag', opts.tag);
  if (opts.q !== undefined) params.set('q', opts.q);
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes${qs}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as NotesListResponse;
  return body.notes;
}

export async function getNote(
  id: string,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<NoteSummary> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as NoteSummary;
}

export async function createNote(
  title?: string,
  opts: { fetch?: FetchLike } = {},
): Promise<CreateNoteResponse> {
  const f = opts.fetch ?? fetch;
  const res = await f('/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(title === undefined ? {} : { title }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CreateNoteResponse;
}

export async function renameNote(
  id: string,
  title: string,
  opts: { fetch?: FetchLike } = {},
): Promise<NoteSummary> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as NoteSummary;
}

export async function retagNote(
  id: string,
  tags: string[],
  opts: { fetch?: FetchLike } = {},
): Promise<NoteSummary> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as NoteSummary;
}

// W-022: soft-delete / restore / hard-delete + list-trashed helpers.
// The server uses DELETE /notes/:id for soft-delete and
// DELETE /notes/:id?forever=true for hard-delete (only allowed on
// already-trashed rows). POST /notes/:id/restore clears trashed_at.

export async function softDeleteNote(id: string, opts: { fetch?: FetchLike } = {}): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await parseError(res);
}

export async function hardDeleteNote(id: string, opts: { fetch?: FetchLike } = {}): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}?forever=true`, { method: 'DELETE' });
  if (!res.ok) throw await parseError(res);
}

export async function restoreNote(id: string, opts: { fetch?: FetchLike } = {}): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  if (!res.ok) throw await parseError(res);
}

export async function listTrashed(
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<NoteSummary[]> {
  const f = opts.fetch ?? fetch;
  const res = await f('/notes/trash', {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as NotesListResponse;
  return body.notes;
}

// W-016: typed inbound-link list for the right pane's Backlinks tab.
// Server shape (S-007) is { backlinks: [{ source_id, source_title,
// link_text }] }; trashed sources are already filtered server-side.
export interface InboundBacklink {
  sourceId: string;
  sourceTitle: string;
  linkText: string;
}

interface BacklinksListResponse {
  backlinks: { source_id: string; source_title: string; link_text: string }[];
}

export async function listBacklinks(
  id: string,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<InboundBacklink[]> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}/backlinks`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as BacklinksListResponse;
  return body.backlinks.map((b) => ({
    sourceId: b.source_id,
    sourceTitle: b.source_title,
    linkText: b.link_text,
  }));
}

// W-025 / I-003: upload one or more `.md` files to the import
// endpoint. The endpoint accepts multipart/form-data with files under
// any field name; we use `files`. Returns the list of created notes
// (id + title) so callers can navigate / refresh.
export interface ImportedNote {
  id: string;
  title: string;
}

interface ImportResponse {
  notes: ImportedNote[];
}

export async function importNotes(
  files: File[],
  opts: { fetch?: FetchLike } = {},
): Promise<ImportedNote[]> {
  const f = opts.fetch ?? fetch;
  const fd = new FormData();
  for (const file of files) {
    fd.append('files', file, file.name);
  }
  const res = await f('/notes/import', {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as ImportResponse;
  return body.notes;
}

// W-027: fetch a single note as markdown (frontmatter + body). The
// server's I-004 endpoint sets a `text/markdown` content type; the
// "Copy as markdown" menu item dumps the result into the clipboard.
export async function exportNoteMarkdown(
  id: string,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<string> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(id)}/export.md`, {
    headers: { accept: 'text/markdown' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  return await res.text();
}
