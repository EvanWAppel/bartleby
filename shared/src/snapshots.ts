// Snapshots REST wire contract. List endpoints return SnapshotSummary
// (no body bytes, no markdown); the detail endpoint adds the Yjs state and
// a markdown preview so the client can render without pulling in Yjs.

/** Entry in the snapshots list. `label` is null for auto-snapshots. */
export interface SnapshotSummary {
  id: string;
  note_id: string;
  label: string | null;
  created_at: string;
}

/** GET /notes/:id/snapshots/:snapshotId — summary plus body payload. */
export interface SnapshotDetail extends SnapshotSummary {
  yjs_state_base64: string;
  markdown_preview: string;
}

/** GET /notes/:id/snapshots. */
export interface SnapshotsListResponse {
  snapshots: SnapshotSummary[];
}
