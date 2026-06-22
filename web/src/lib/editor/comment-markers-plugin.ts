// W-018 in-body comment markers.
//
// Reads the current top-level comment list (via a getter callback so
// the plugin doesn't reach into Svelte $state types directly) and
// renders one numbered chip per anchorable comment as a PM inline
// Decoration. The chip is a `<button data-comment-marker>` that fires
// onMarkerClick(commentId) when the user clicks it — Editor.svelte
// wires that callback to switch the right pane to Comments and
// scroll the thread into view.
//
// Numbering is 1-based by created_at order (the natural reading order
// down the doc would be position-based, but server-side ordering keeps
// the marker numbers stable across edits — if marker #3 moves up the
// doc when a paragraph above it gets deleted, it's still thread #3).
// Resolved comments are skipped here even when the pane shows them
// (they shouldn't clutter the live reading surface).
//
// Orphaned comments (resolveAnchor returns null) are skipped — there's
// no body position to paint. The pane still shows them; C-008 will add
// an explicit orphan flag down the road.

import type { Plugin as PMPlugin, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { resolveAnchor } from './comment-anchor.js';
import type { CommentDto } from '$lib/api/comments';

export interface CommentMarkersDeps {
  /** Pulled lazily so the plugin re-reads on every doc/state change
   * without owning a reactive subscription. */
  getComments: () => CommentDto[];
  onMarkerClick: (commentId: string) => void;
}

/**
 * Dispatch a no-op transaction that forces the markers plugin to
 * rebuild. Call this when the comments list changes WITHOUT a doc
 * change (post / reply / resolve / delete from outside the editor)
 * — `apply` rebuilds decorations on every transaction so a bare
 * setMeta is enough.
 */
export function refreshCommentMarkers(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(REFRESH_MARKERS, true) as Transaction);
}

const REFRESH_MARKERS = 'bartleby:refresh-comment-markers';

export async function buildCommentMarkersPlugin(deps: CommentMarkersDeps): Promise<PMPlugin> {
  const { getComments, onMarkerClick } = deps;
  const { Plugin, PluginKey } = await import('prosemirror-state');
  const { Decoration, DecorationSet } = await import('prosemirror-view');
  const key = new PluginKey('comment-markers');

  function buildDecorations(state: EditorState): InstanceType<typeof DecorationSet> {
    const comments = getComments();
    // Only top-level (no parent), open (not resolved), with a non-empty
    // anchor. Number 1-based in created_at order; the API already
    // returns rows sorted by created_at + id.
    const tops = comments.filter(
      (c) => c.parent_comment_id === null && c.resolved_at === null && c.anchor !== '',
    );
    const decorations: InstanceType<typeof Decoration>[] = [];
    tops.forEach((c, i) => {
      const range = resolveAnchor(state, c.anchor);
      if (range === null) return;
      const num = i + 1;
      const widget = Decoration.widget(
        range.to,
        () => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-comment-marker', c.id);
          btn.setAttribute('data-comment-number', String(num));
          btn.setAttribute('aria-label', `Comment ${num}`);
          btn.textContent = String(num);
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkerClick(c.id);
          });
          // Don't blur the editor when clicking the marker — same
          // idiom as the toolbar / picker components.
          btn.addEventListener('mousedown', (e) => e.preventDefault());
          return btn;
        },
        { side: 1, ignoreSelection: true },
      );
      decorations.push(widget);
    });
    return DecorationSet.create(state.doc, decorations);
  }

  return new Plugin({
    key,
    state: {
      init(_config, state) {
        return buildDecorations(state);
      },
      apply(_tr, _value, _old, newState) {
        return buildDecorations(newState);
      },
    },
    props: {
      decorations(state) {
        return key.getState(state) as InstanceType<typeof DecorationSet> | null;
      },
    },
  });
}
