// C-002..C-006: abstraction over "open the live Y.Doc for note X".
//
// In production this is backed by Hocuspocus's openDirectConnection
// (the WS server and HTTP server live in the same Node process, see
// index.ts). Tests inject a stub that resolves to a pre-built Y.Doc
// without spinning up a WebSocket server.
//
// The two operations we need are:
//   - read(): get a snapshot of the current state as an opaque buffer
//     (for C-003 named snapshots + C-002 scheduler).
//   - replace(): replace the doc's content with a given Yjs state
//     (for C-006 restore). Yjs's applyUpdate semantics MERGE rather
//     than REPLACE, so the implementation has to clear the
//     prosemirror XmlFragment before applying — see the production
//     impl for the y-prosemirror two-step.
//
// We deliberately keep the surface tiny — anything that needs the live
// Y.Doc (S-009-style hooks, the C-002 scheduler) goes through this
// accessor.

import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode, prosemirrorToYXmlFragment } from 'y-prosemirror';
import type { Hocuspocus } from '@hocuspocus/server';
import { schema } from '../derived/schema.js';

export interface YjsDocAccessor {
  /** Returns an encoded full-state update of the doc for `noteId`. */
  read(noteId: string): Promise<Uint8Array>;
  /** Replaces the doc's content with the given encoded full-state update. */
  replace(noteId: string, encoded: Uint8Array): Promise<void>;
}

/**
 * Production accessor backed by Hocuspocus's openDirectConnection.
 *
 * Each operation opens a connection, runs the transaction, and
 * disconnects. The disconnect happens unconditionally (finally) so a
 * failure inside the transaction doesn't leak the connection. Note
 * that openDirectConnection lazy-loads the document via the SQLite
 * extension, so we don't need to "warm up" the doc separately.
 */
export function createHocuspocusAccessor(hocuspocus: Hocuspocus): YjsDocAccessor {
  return {
    async read(noteId): Promise<Uint8Array> {
      const conn = await hocuspocus.openDirectConnection(noteId);
      try {
        let bytes: Uint8Array = new Uint8Array();
        // Hocuspocus's Document class extends Y.Doc directly, so the
        // transact callback hands us a Y.Doc-shaped object — no
        // `.document` indirection. Encode the full state; the snapshot
        // caller stores the bytes opaquely.
        await conn.transact((doc) => {
          bytes = Y.encodeStateAsUpdate(doc as unknown as Y.Doc);
        });
        return bytes;
      } finally {
        await conn.disconnect();
      }
    },
    async replace(noteId, encoded): Promise<void> {
      const conn = await hocuspocus.openDirectConnection(noteId);
      try {
        await conn.transact((doc) => {
          replaceYDocContent(doc as unknown as Y.Doc, encoded);
        });
      } finally {
        await conn.disconnect();
      }
    },
  };
}

/**
 * Test helper: build an accessor from an in-memory `Map<noteId, Y.Doc>`.
 * Mutating the underlying Y.Doc via the returned accessor mutates the
 * Map entry — useful for verifying restore round-trips end-to-end.
 */
export function createInMemoryAccessor(docs: Map<string, Y.Doc>): YjsDocAccessor {
  return {
    async read(noteId): Promise<Uint8Array> {
      const doc = docs.get(noteId);
      if (doc === undefined) {
        // No doc yet → return an empty state. A note that's never been
        // opened has no Yjs state; an "empty" snapshot is a valid
        // restore target.
        const empty = new Y.Doc();
        return Y.encodeStateAsUpdate(empty);
      }
      return Y.encodeStateAsUpdate(doc);
    },
    async replace(noteId, encoded): Promise<void> {
      let doc = docs.get(noteId);
      if (doc === undefined) {
        doc = new Y.Doc();
        docs.set(noteId, doc);
      }
      replaceYDocContent(doc, encoded);
    },
  };
}

/**
 * Replace `liveDoc`'s prosemirror XmlFragment with the content of
 * `encoded`. Yjs's applyUpdate alone would merge rather than replace,
 * so we go through the y-prosemirror serializer:
 *   1. Decode `encoded` into a throwaway Y.Doc.
 *   2. Convert that doc's fragment into a ProseMirror Node tree.
 *   3. Inside one transaction on liveDoc: clear the live fragment,
 *      then re-insert from the PM tree.
 *
 * Single transaction = single Yjs update for connected peers, which is
 * what C-006 needs ("snapshot's Yjs state applied to the live doc").
 */
export function replaceYDocContent(liveDoc: Y.Doc, encoded: Uint8Array): void {
  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, encoded);
  const snapshotFragment = snapshotDoc.getXmlFragment('prosemirror');
  // Convert to a PM Node tree we can splat back into the live doc.
  // If the snapshot was empty (length 0) we just clear the live fragment.
  if (snapshotFragment.length === 0) {
    liveDoc.transact(() => {
      const liveFragment = liveDoc.getXmlFragment('prosemirror');
      liveFragment.delete(0, liveFragment.length);
    });
    return;
  }
  const pmRoot = yXmlFragmentToProseMirrorRootNode(snapshotFragment, schema);
  liveDoc.transact(() => {
    const liveFragment = liveDoc.getXmlFragment('prosemirror');
    liveFragment.delete(0, liveFragment.length);
    prosemirrorToYXmlFragment(pmRoot, liveFragment);
  });
}
