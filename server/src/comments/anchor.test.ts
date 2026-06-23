// C-008/C-009: server-side anchor resolution.
//
// Builds a Yjs doc the same way the client would (PM tree -> XmlFragment),
// captures an anchor for a known text range, and asserts:
//   - the anchor resolves to the original text (C-009 snapshot path)
//   - deleting the anchored text orphans the anchor (C-008 detect path)
//   - empty / malformed anchors are treated as orphaned

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  prosemirrorToYXmlFragment,
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
} from 'y-prosemirror';
import { schema } from '../derived/schema.js';
import { isAnchorOrphaned, resolveAnchorToText } from './anchor.js';

/**
 * Build a YDoc whose `prosemirror` XmlFragment contains a single
 * paragraph with `text`. Returns the doc + a helper that captures an
 * anchor for a PM range, JSON-serialized the same way the web client
 * does in comment-anchor.ts.
 */
function buildSeededDoc(text: string): {
  ydoc: Y.Doc;
  anchorFor: (from: number, to: number) => string;
} {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('prosemirror');
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]),
    fragment,
  );
  const anchorFor = (from: number, to: number): string => {
    // Mirror the web client: it builds the anchor at create time
    // against the current PM mapping. The mapping is reproducible from
    // the YDoc via initProseMirrorDoc.
    const { mapping } = initProseMirrorDoc(fragment, schema);
    const fromRel = absolutePositionToRelativePosition(from, fragment, mapping as never);
    const toRel = absolutePositionToRelativePosition(to, fragment, mapping as never);
    return JSON.stringify({
      from: Y.relativePositionToJSON(fromRel),
      to: Y.relativePositionToJSON(toRel),
    });
  };
  return { ydoc, anchorFor };
}

describe('isAnchorOrphaned (C-008)', () => {
  test('empty anchor is treated as orphaned', () => {
    const { ydoc } = buildSeededDoc('hello world');
    expect(isAnchorOrphaned(ydoc, '')).toBe(true);
  });

  test('malformed anchor JSON is treated as orphaned', () => {
    const { ydoc } = buildSeededDoc('hello world');
    expect(isAnchorOrphaned(ydoc, '{not json')).toBe(true);
  });

  test('anchor missing from/to fields is treated as orphaned', () => {
    const { ydoc } = buildSeededDoc('hello world');
    expect(isAnchorOrphaned(ydoc, '{}')).toBe(true);
  });

  test('fresh anchor against unchanged doc is NOT orphaned', () => {
    // "hello world" → PM positions: doc=0, p_open=1, h=1, e=2, l=3, l=4, o=5,
    // space=6, w=7, o=8, r=9, l=10, d=11, p_close=12. Anchor "world" = [7,12].
    const { ydoc, anchorFor } = buildSeededDoc('hello world');
    const anchor = anchorFor(7, 12);
    expect(isAnchorOrphaned(ydoc, anchor)).toBe(false);
  });

  test('orphans when the anchored span is deleted', () => {
    const { ydoc, anchorFor } = buildSeededDoc('hello world');
    // Anchor "world".
    const anchor = anchorFor(7, 12);

    // Replace the doc's prosemirror fragment with a fresh paragraph
    // that doesn't contain the anchored span. The Yjs items the anchor
    // points at get tombstoned; createAbsolutePositionFromRelativePosition
    // returns null on a tombstoned item.
    const fragment = ydoc.getXmlFragment('prosemirror');
    ydoc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(
        schema.node('doc', null, [schema.node('paragraph', null, [schema.text('different')])]),
        fragment,
      );
    });

    expect(isAnchorOrphaned(ydoc, anchor)).toBe(true);
  });
});

describe('resolveAnchorToText (C-009)', () => {
  test('returns the text currently between the two endpoints', () => {
    const { ydoc, anchorFor } = buildSeededDoc('hello world');
    // "world" = PM positions [7, 12].
    const anchor = anchorFor(7, 12);
    expect(resolveAnchorToText(ydoc, anchor)).toBe('world');
  });

  test('handles a full-paragraph selection', () => {
    const { ydoc, anchorFor } = buildSeededDoc('hello world');
    // The whole paragraph contents: PM [1, 12].
    const anchor = anchorFor(1, 12);
    expect(resolveAnchorToText(ydoc, anchor)).toBe('hello world');
  });

  test('returns null for an empty anchor string', () => {
    const { ydoc } = buildSeededDoc('hello world');
    expect(resolveAnchorToText(ydoc, '')).toBeNull();
  });

  test('returns null when the doc is empty (no prosemirror content yet)', () => {
    const { anchorFor } = buildSeededDoc('hello world');
    const anchor = anchorFor(7, 12);
    // Different empty doc.
    const empty = new Y.Doc();
    expect(resolveAnchorToText(empty, anchor)).toBeNull();
  });

  test('returns null when the anchored span has been deleted (orphaned)', () => {
    const { ydoc, anchorFor } = buildSeededDoc('hello world');
    const anchor = anchorFor(7, 12);
    const fragment = ydoc.getXmlFragment('prosemirror');
    ydoc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(
        schema.node('doc', null, [schema.node('paragraph', null, [schema.text('different')])]),
        fragment,
      );
    });
    expect(resolveAnchorToText(ydoc, anchor)).toBeNull();
  });
});
