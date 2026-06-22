// W-017 / C-007: typed wrapper over the bartleby comments REST API.
// Mirrors the server's CommentRow shape (snake_case) verbatim — the
// pane component does its own camelCase mapping for readability.

export interface CommentDto {
  id: string;
  note_id: string;
  author_id: string;
  parent_comment_id: string | null;
  anchor: string;
  original_quote: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

export class CommentsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'CommentsApiError';
  }
}

type FetchLike = typeof fetch;

async function parseError(res: Response): Promise<CommentsApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new CommentsApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new CommentsApiError(res.status, 'unknown', res.statusText);
  }
}

export interface ListCommentsOptions {
  includeResolved?: boolean;
  signal?: AbortSignal;
  fetch?: FetchLike;
}

export async function listComments(
  noteId: string,
  opts: ListCommentsOptions = {},
): Promise<CommentDto[]> {
  const f = opts.fetch ?? fetch;
  const q = opts.includeResolved === true ? '?include=resolved' : '';
  const res = await f(`/notes/${encodeURIComponent(noteId)}/comments${q}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { comments: CommentDto[] };
  return body.comments;
}

export interface CreateCommentInput {
  anchor?: string;
  originalQuote?: string;
  body: string;
}

export async function createComment(
  noteId: string,
  input: CreateCommentInput,
  opts: { fetch?: FetchLike } = {},
): Promise<CommentDto> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/notes/${encodeURIComponent(noteId)}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      anchor: input.anchor ?? '',
      original_quote: input.originalQuote ?? '',
      body: input.body,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CommentDto;
}

export async function replyToComment(
  parentId: string,
  body: string,
  opts: { fetch?: FetchLike } = {},
): Promise<CommentDto> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/comments/${encodeURIComponent(parentId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CommentDto;
}

export async function resolveComment(
  id: string,
  opts: { fetch?: FetchLike } = {},
): Promise<CommentDto> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/comments/${encodeURIComponent(id)}/resolve`, { method: 'PATCH' });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CommentDto;
}

export async function reopenComment(
  id: string,
  opts: { fetch?: FetchLike } = {},
): Promise<CommentDto> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/comments/${encodeURIComponent(id)}/reopen`, { method: 'PATCH' });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CommentDto;
}

export async function deleteComment(id: string, opts: { fetch?: FetchLike } = {}): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await parseError(res);
}
