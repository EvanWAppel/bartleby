// Mentions REST wire contract. The server returns its mention row with the
// target note's title joined in (server/src/mentions/routes.ts withNoteTitle).

/** A single @mention of the current user. `note_title` is a joined convenience. */
export interface MentionDto {
  id: string;
  note_id: string;
  mentioned_user_id: string;
  mentioning_user_id: string;
  source: string;
  created_at: string;
  read_at: string | null;
  email_sent_at: string | null;
  note_title: string;
}

/** GET /mentions. */
export interface MentionsListResponse {
  mentions: MentionDto[];
}
