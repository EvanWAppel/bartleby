import type { Database } from 'better-sqlite3';
import type { BacklinkRow } from './types.js';

export interface BacklinkInput {
  target_note_id: string;
  link_text: string;
}

export interface BacklinksRepository {
  replaceForSource(sourceId: string, links: BacklinkInput[]): void;
  listInbound(targetId: string): BacklinkRow[];
  listOutbound(sourceId: string): BacklinkRow[];
}

export function createBacklinksRepository(db: Database): BacklinksRepository {
  const deleteForSourceStmt = db.prepare(`DELETE FROM backlinks WHERE source_note_id = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO backlinks (source_note_id, target_note_id, link_text) VALUES (?, ?, ?)`,
  );
  const listInboundStmt = db.prepare<[string], BacklinkRow>(
    `SELECT * FROM backlinks WHERE target_note_id = ? ORDER BY source_note_id, id`,
  );
  const listOutboundStmt = db.prepare<[string], BacklinkRow>(
    `SELECT * FROM backlinks WHERE source_note_id = ? ORDER BY target_note_id, id`,
  );

  const replaceTxn = db.transaction((sourceId: string, links: BacklinkInput[]) => {
    deleteForSourceStmt.run(sourceId);
    for (const link of links) {
      insertStmt.run(sourceId, link.target_note_id, link.link_text);
    }
  });

  return {
    replaceForSource: (sourceId, links) => replaceTxn(sourceId, links),
    listInbound: (targetId) => listInboundStmt.all(targetId),
    listOutbound: (sourceId) => listOutboundStmt.all(sourceId),
  };
}
