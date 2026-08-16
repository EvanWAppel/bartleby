// Comments REST wire contract. The server passes its DB comment row
// through verbatim (server/src/comments/routes.ts toDto), so the wire shape
// is snake_case and matches the row. The web pane maps to camelCase for
// display; that transform stays in the web layer.

/** A single comment. Anchor is the serialized Yjs RelativePosition pair. */
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
  /**
   * C-008: true when the anchored span has been deleted. Stored as INTEGER
   * 0/1 in SQLite, surfaced as boolean on the wire. The server has always
   * sent this; extracting the shared contract is what added it to the web's
   * view of the type (the web api layer previously omitted it).
   */
  is_orphaned: boolean;
}

/** GET /notes/:id/comments. */
export interface CommentsListResponse {
  comments: CommentDto[];
}
