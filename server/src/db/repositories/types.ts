// Row shapes returned by repositories. Mirrors the migration column set
// 1:1; nullable columns are typed as `T | null` (better-sqlite3 returns
// SQL NULL as JS null, not undefined).

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  color: string;
  created_at: string;
}

export interface NoteRow {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  markdown_export: string;
}

export interface NoteTitleHistoryRow {
  id: number;
  note_id: string;
  title: string;
  valid_from: string;
  valid_to: string | null;
}

export interface BacklinkRow {
  id: number;
  source_note_id: string;
  target_note_id: string;
  link_text: string;
}

export interface CommentRow {
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

export interface SnapshotRow {
  id: string;
  note_id: string;
  yjs_state: Buffer;
  created_at: string;
  label: string | null;
}

export interface MentionRow {
  id: string;
  note_id: string;
  mentioned_user_id: string;
  mentioning_user_id: string;
  source: string;
  created_at: string;
  read_at: string | null;
  email_sent_at: string | null;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}
