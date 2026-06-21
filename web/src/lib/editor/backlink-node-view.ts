// W-012 NodeView for the backlink inline atom.
//
// We render the same `<a href="/n/{id}">{title}</a>` shape the schema's
// default toDOM produces, but intercept plain click so we can navigate
// via SvelteKit's `goto` instead of letting the browser do a full-page
// load. ProseMirror also normally intercepts clicks on atom nodes for
// selection purposes, so the explicit `click` handler here is the only
// place navigation can reliably fire.
//
// We keep the node `atom: true` (set in the schema) — backspace deletes
// the whole node, the title is fixed at insert time, and any in-place
// editing the user wants happens via remove + re-insert through the
// picker.

import type { NodeView, EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

export interface BacklinkNodeViewDeps {
  /** Navigate to the given path. Editor.svelte passes SvelteKit's `goto`. */
  navigate: (path: string) => void;
}

export function createBacklinkNodeViewFactory(deps: BacklinkNodeViewDeps) {
  return (initialNode: Node, _view: EditorView, _getPos: () => number | undefined): NodeView => {
    let node = initialNode;

    const dom = document.createElement('a');
    dom.setAttribute('data-backlink', '');

    function refreshAttrs(): void {
      const targetId = String(node.attrs['targetId']);
      const title = String(node.attrs['title']);
      dom.setAttribute('data-backlink-target', targetId);
      dom.setAttribute('href', `/n/${targetId}`);
      dom.textContent = title;
    }
    refreshAttrs();

    dom.addEventListener('click', (e) => {
      e.preventDefault();
      // Stop ProseMirror's own click handler from selecting the atom;
      // navigation is the only behavior we want for a plain click.
      e.stopPropagation();
      const targetId = String(node.attrs['targetId']);
      if (targetId.length === 0) return;
      deps.navigate(`/n/${targetId}`);
    });

    return {
      dom,
      update(updated): boolean {
        if (updated.type !== node.type) return false;
        node = updated;
        refreshAttrs();
        return true;
      },
      stopEvent(event): boolean {
        // Let PM see arrow-key etc. events normally, but absorb the
        // click so navigation isn't fought with cursor placement.
        return event.type === 'click';
      },
      ignoreMutation(): boolean {
        // We rewrite textContent on every update(); PM shouldn't try
        // to reconcile those mutations against the doc.
        return true;
      },
    };
  };
}
