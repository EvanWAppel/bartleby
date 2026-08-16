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
}

/** GET /notes/:id/comments. */
export interface CommentsListResponse {
  comments: CommentDto[];
}
