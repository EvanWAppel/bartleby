// W-018 comment anchor (de)serialization.
//
// PRD §6.4 + C-007 say the anchor field is "a serialized Yjs
// RelativePosition pair". A pair because a comment anchors to a RANGE
// (the selected text at create time), not a single caret. Yjs's
// RelativePosition is the stable identity for a position across edits
// — even concurrent inserts before the anchored range still leave the
// RelativePosition pointing at the same logical span.
//
// Storage shape (string JSON in the `comments.anchor` column):
//
//   {
//     "from": <RelativePositionJSON>,
//     "to":   <RelativePositionJSON>
//   }
//
// The server treats this as opaque bytes (no parse, no validation —
// see comments/routes.ts). C-008's orphan detection will deserialize
// it the same way the editor does. If `to` resolves to null (the
// anchored text was deleted), the comment is orphaned in C-008's
// terms; v1 still renders it in the pane but the body marker won't
// paint.

import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror';
import type { EditorState } from 'prosemirror-state';

export interface SerializedAnchor {
  from: unknown;
  to: unknown;
}

interface YBindingState {
  type: Y.XmlFragment;
  binding: { mapping: unknown };
  doc: Y.Doc;
}

function getYBinding(state: EditorState): YBindingState | null {
  const ystate = ySyncPluginKey.getState(state) as YBindingState | null | undefined;
  if (ystate === null || ystate === undefined) return null;
  if (ystate.binding === null || ystate.binding === undefined) return null;
  return ystate;
}

/**
 * Build a serialized anchor from a PM (from, to) range. Returns null
 * if the editor isn't bound to a Yjs doc yet (Phase 0 fixture; or
 * pre-mount race).
 */
export function buildAnchor(
  state: EditorState,
  range: { from: number; to: number },
): SerializedAnchor | null {
  const ystate = getYBinding(state);
  if (ystate === null) return null;
  const fromRel = absolutePositionToRelativePosition(
    range.from,
    ystate.type,
    ystate.binding.mapping as never,
  );
  const toRel = absolutePositionToRelativePosition(
    range.to,
    ystate.type,
    ystate.binding.mapping as never,
  );
  return {
    from: Y.relativePositionToJSON(fromRel),
    to: Y.relativePositionToJSON(toRel),
  };
}

/**
 * Resolve a serialized anchor back to a PM (from, to) range in the
 * current state. Returns null if the anchor is invalid JSON, missing
 * fields, or the anchored content has been deleted (orphan — C-008
 * will mark these). Either endpoint resolving to null counts as an
 * orphan.
 */
export function resolveAnchor(
  state: EditorState,
  serialized: string,
): { from: number; to: number } | null {
  if (serialized === '' || serialized === undefined) return null;
  let parsed: SerializedAnchor;
  try {
    parsed = JSON.parse(serialized) as SerializedAnchor;
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.from === undefined ||
    parsed.to === undefined
  ) {
    return null;
  }
  const ystate = getYBinding(state);
  if (ystate === null) return null;
  const fromRel = Y.createRelativePositionFromJSON(parsed.from);
  const toRel = Y.createRelativePositionFromJSON(parsed.to);
  const from = relativePositionToAbsolutePosition(
    ystate.doc,
    ystate.type,
    fromRel,
    ystate.binding.mapping as never,
  );
  const to = relativePositionToAbsolutePosition(
    ystate.doc,
    ystate.type,
    toRel,
    ystate.binding.mapping as never,
  );
  if (from === null || to === null) return null;
  // Normalize: PM positions are always [from, to] with from <= to.
  if (from <= to) return { from, to };
  return { from: to, to: from };
}

/** Stringify for the wire (POST body). */
export function serializeAnchor(anchor: SerializedAnchor): string {
  return JSON.stringify(anchor);
}
