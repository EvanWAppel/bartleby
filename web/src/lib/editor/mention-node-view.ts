// W-013 NodeView for the mention inline atom.
//
// Renders the same `<span data-mention>@displayName</span>` shape the
// schema's toDOM produces. Unlike the W-012 backlink NodeView this is
// non-interactive — the mention chip carries no click handler in v1;
// W-023's mentions inbox is where you navigate to your own mentions
// from, not from clicking somebody else's body text. Keeping the chip
// inert also avoids stealing clicks from the editor (the user can
// still place the caret next to a mention by clicking near it).
//
// We keep the node `atom: true` (set in the schema) — backspace deletes
// the whole node, the email/displayName are fixed at insert time, and
// any in-place editing the user wants happens via remove + re-insert
// through the picker.

import type { NodeView, EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

export function createMentionNodeView(
  initialNode: Node,
  _view: EditorView,
  _getPos: () => number | undefined,
): NodeView {
  let node = initialNode;

  const dom = document.createElement('span');
  dom.setAttribute('data-mention', '');

  function refreshAttrs(): void {
    const email = String(node.attrs['email']);
    const displayName = String(node.attrs['displayName']);
    dom.setAttribute('data-mention-email', email);
    dom.setAttribute('data-mention-display', displayName);
    dom.textContent = displayName.length > 0 ? `@${displayName}` : `@${email}`;
  }
  refreshAttrs();

  return {
    dom,
    update(updated): boolean {
      if (updated.type !== node.type) return false;
      node = updated;
      refreshAttrs();
      return true;
    },
    ignoreMutation(): boolean {
      return true;
    },
  };
}
