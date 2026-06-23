// C-008/C-009 server-side comment anchor resolution.
//
// The anchor is JSON-serialized by the web client (web/src/lib/editor/
// comment-anchor.ts) as:
//
//   { "from": <RelativePositionJSON>, "to": <RelativePositionJSON> }
//
// Each RelativePosition is rooted in the `prosemirror` YXmlFragment of
// the note's YDoc. Server-side we can resolve them with
// Y.createAbsolutePositionFromRelativePosition(rpos, doc) — that returns
// an AbsolutePosition or null. Null on either endpoint means the
// anchored span no longer exists in the document; the comment is
// orphaned in C-008's terms.
//
// For C-009 we need the *text* between the two positions at create time
// (so an orphan can still show the user what they originally commented
// on). Yjs by itself only gives us position-within-type, not "text
// between two prosemirror positions". The trick is to use y-prosemirror's
// `relativePositionToAbsolutePosition`, which returns a PM-coordinate
// integer, paired with a freshly-built PM Node tree (via
// `initProseMirrorDoc`) — then `node.textBetween(from, to)` extracts the
// text. This mirrors what the web side does when it builds the original
// quote pre-POST; the server recomputes from the same Yjs source of
// truth so the snapshot can't drift from the doc.

import * as Y from 'yjs';
import { initProseMirrorDoc, relativePositionToAbsolutePosition } from 'y-prosemirror';
import { schema } from '../derived/schema.js';

interface SerializedAnchor {
  from: unknown;
  to: unknown;
}

function tryParseAnchor(serialized: string): SerializedAnchor | null {
  if (serialized === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as { from?: unknown; to?: unknown };
  if (obj.from === undefined || obj.to === undefined) return null;
  return { from: obj.from, to: obj.to };
}

/**
 * Returns true when *either* endpoint of the anchor fails to resolve
 * against the current YDoc state — i.e. the anchored span has been
 * deleted. Unparseable / empty anchors also count as orphaned, since we
 * have no way to confirm they still point at anything.
 *
 * Resolution uses Y.createAbsolutePositionFromRelativePosition directly
 * (no PM mapping needed for the boolean answer) — see the y-prosemirror
 * source for the equivalent flow on the client.
 */
export function isAnchorOrphaned(ydoc: Y.Doc, serializedAnchor: string): boolean {
  const parsed = tryParseAnchor(serializedAnchor);
  if (parsed === null) return true;
  const fromRel = Y.createRelativePositionFromJSON(parsed.from);
  const toRel = Y.createRelativePositionFromJSON(parsed.to);
  const fromAbs = Y.createAbsolutePositionFromRelativePosition(fromRel, ydoc);
  const toAbs = Y.createAbsolutePositionFromRelativePosition(toRel, ydoc);
  return fromAbs === null || toAbs === null;
}

/**
 * Extract the text currently between the two anchor endpoints, for use
 * as `original_quote`. Returns null if:
 *   - the anchor is empty / unparseable
 *   - either endpoint fails to resolve (orphan at creation — odd, but
 *     we'd rather store nothing than nonsense)
 *   - the YDoc has no prosemirror content yet
 *
 * The caller decides how to handle null (typically: fall back to the
 * client-supplied original_quote, or store '').
 */
export function resolveAnchorToText(ydoc: Y.Doc, serializedAnchor: string): string | null {
  const parsed = tryParseAnchor(serializedAnchor);
  if (parsed === null) return null;

  const fragment = ydoc.getXmlFragment('prosemirror');
  if (fragment.length === 0) return null;

  // initProseMirrorDoc builds the PM root node AND the y-prosemirror
  // mapping. The mapping is what relativePositionToAbsolutePosition
  // needs to translate Yjs item positions back into PM positions.
  const { doc: pmDoc, mapping } = initProseMirrorDoc(fragment, schema);

  const fromRel = Y.createRelativePositionFromJSON(parsed.from);
  const toRel = Y.createRelativePositionFromJSON(parsed.to);
  const fromPm = relativePositionToAbsolutePosition(ydoc, fragment, fromRel, mapping);
  const toPm = relativePositionToAbsolutePosition(ydoc, fragment, toRel, mapping);
  if (fromPm === null || toPm === null) return null;

  // PM positions are signed; normalize to [low, high] before slicing.
  const lo = Math.min(fromPm, toPm);
  const hi = Math.max(fromPm, toPm);
  if (lo === hi) return '';

  // Guard against out-of-range positions that would throw inside
  // textBetween — this can happen if the doc shrank below where the
  // resolver thinks the endpoint sits. Bail to "we don't know" rather
  // than crashing the request.
  if (lo < 0 || hi > pmDoc.content.size) return null;
  return pmDoc.textBetween(lo, hi, '\n', ' ');
}
