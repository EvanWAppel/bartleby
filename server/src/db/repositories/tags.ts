import type { Database } from 'better-sqlite3';

export interface TagsRepository {
  replaceForNote(noteId: string, tags: string[]): void;
  listForNote(noteId: string): string[];
  listNotesByTag(tag: string): string[];
}

export function createTagsRepository(db: Database): TagsRepository {
  const deleteForNoteStmt = db.prepare(`DELETE FROM tags WHERE note_id = ?`);
  const insertStmt = db.prepare(`INSERT INTO tags (note_id, tag) VALUES (?, ?)`);
  const listForNoteStmt = db.prepare<[string], { tag: string }>(
    `SELECT tag FROM tags WHERE note_id = ? ORDER BY tag`,
  );
  const listNotesByTagStmt = db.prepare<[string], { note_id: string }>(
    `SELECT note_id FROM tags WHERE tag = ? ORDER BY note_id`,
  );

  const replaceTxn = db.transaction((noteId: string, tags: string[]) => {
    deleteForNoteStmt.run(noteId);
    const unique = [...new Set(tags)];
    for (const tag of unique) {
      insertStmt.run(noteId, tag);
    }
  });

  return {
    replaceForNote: (noteId, tags) => replaceTxn(noteId, tags),
    listForNote: (noteId) => listForNoteStmt.all(noteId).map((r) => r.tag),
    listNotesByTag: (tag) => listNotesByTagStmt.all(tag).map((r) => r.note_id),
  };
}
