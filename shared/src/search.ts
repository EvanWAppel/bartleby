// Search REST wire contract (FTS5-backed). The snippet contains literal
// "<mark>...</mark>" markers around matched terms; the web splits it into
// safe segments rather than rendering it as HTML.

/** One search result. */
export interface SearchHit {
  id: string;
  title: string;
  /** Server-returned snippet with literal "<mark>...</mark>" markers. */
  snippet: string;
}

/** GET /search. */
export interface SearchListResponse {
  hits: SearchHit[];
}
