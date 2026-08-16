// W-023 / M-003/M-004: typed wrapper over the mentions REST API.
// Server row shape (with `note_title` joined in) — see
// server/src/mentions/routes.ts.

import type { MentionDto } from '@bartleby/shared';

// Re-export so components importing MentionDto from this module are
// unaffected by the move to the shared wire contract.
export type { MentionDto };

export class MentionsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'MentionsApiError';
  }
}

type FetchLike = typeof fetch;

async function parseError(res: Response): Promise<MentionsApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new MentionsApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new MentionsApiError(res.status, 'unknown', res.statusText);
  }
}

export async function listMentions(
  opts: { unread?: boolean; signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<MentionDto[]> {
  const f = opts.fetch ?? fetch;
  const qs = opts.unread === true ? '?unread=true' : '';
  const res = await f(`/mentions${qs}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { mentions: MentionDto[] };
  return body.mentions;
}

export async function markMentionRead(
  id: string,
  opts: { fetch?: FetchLike } = {},
): Promise<MentionDto> {
  const f = opts.fetch ?? fetch;
  const res = await f(`/mentions/${encodeURIComponent(id)}/read`, { method: 'POST' });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MentionDto;
}
