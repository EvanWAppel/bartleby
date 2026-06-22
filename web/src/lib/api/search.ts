// W-020 search client. Thin wrapper over the existing S-011 endpoint.
//
// The server's snippet() output uses literal "<mark>" / "</mark>"
// markers around matched terms. We do NOT render the snippet via
// {@html} — note bodies can contain arbitrary user-controlled text
// (including a bare "<script>") and FTS5's snippet function passes
// that text through verbatim. `parseSnippet` instead breaks the
// returned string into safe `{ text, highlighted }` segments that the
// overlay renders as plain text nodes with a <mark> wrapper.

export interface SearchHit {
  id: string;
  title: string;
  /** Server-returned snippet with literal "<mark>...</mark>" markers. */
  snippet: string;
}

export class SearchApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'SearchApiError';
  }
}

type FetchLike = typeof fetch;

async function parseError(res: Response): Promise<SearchApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new SearchApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new SearchApiError(res.status, 'unknown', res.statusText);
  }
}

export async function searchNotes(
  query: string,
  opts: { limit?: number; signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<SearchHit[]> {
  const f = opts.fetch ?? fetch;
  const params = new URLSearchParams();
  params.set('q', query);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const res = await f(`/search?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { hits: SearchHit[] };
  return body.hits;
}

export interface SnippetSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Break a snippet like "the …<mark>quick</mark> brown <mark>fox</mark>…"
 * into ordered segments. The output is rendered as plain text + <mark>
 * tags — Svelte's text interpolation escapes the text so any embedded
 * "<script>" stays inert.
 *
 * Unbalanced/missing markers fall through as plain text — the snippet
 * still renders, it just doesn't get highlighted in those spots.
 */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let lastIndex = 0;
  for (;;) {
    const m = pattern.exec(snippet);
    if (m === null) break;
    if (m.index > lastIndex) {
      segments.push({ text: snippet.slice(lastIndex, m.index), highlighted: false });
    }
    segments.push({ text: m[1] ?? '', highlighted: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < snippet.length) {
    segments.push({ text: snippet.slice(lastIndex), highlighted: false });
  }
  return segments;
}
