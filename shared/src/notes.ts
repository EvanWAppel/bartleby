// Notes REST wire contract. These are the exact JSON shapes the server
// returns (snake_case, matching the DB columns) and the web client parses.
// The server produces them in server/src/notes/routes.ts; the web consumes
// them in web/src/lib/api/notes.ts. Client-side camelCase transforms
// (e.g. InboundBacklink) are web-only conveniences and stay in the web api
// layer — only the wire shapes live here.

/** A note's list/detail metadata. GET /notes/:id, and entries in list responses. */
export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  updated_at: string;
  created_at: string;
}

/** GET /notes and GET /notes/trash. */
export interface NotesListResponse {
  notes: NoteSummary[];
}

/** POST /notes (201). */
export interface CreateNoteResponse {
  id: string;
  title: string;
}

/** One inbound link, as returned by GET /notes/:id/backlinks. */
export interface BacklinkEntry {
  source_id: string;
  source_title: string;
  link_text: string;
}

/** GET /notes/:id/backlinks. Trashed sources are filtered server-side. */
export interface BacklinksListResponse {
  backlinks: BacklinkEntry[];
}

/** One created note returned by the import endpoint. */
export interface ImportedNoteRef {
  id: string;
  title: string;
}

/** POST /notes/import (multipart). */
export interface ImportResponse {
  notes: ImportedNoteRef[];
}
