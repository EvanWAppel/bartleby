// W-010 NodeView for task_item: renders an <li> containing a native
// <input type="checkbox"> + a contentDOM for the editable paragraph.
//
// The checkbox is `contenteditable=false` so ProseMirror doesn't try
// to put a cursor inside it. We intercept the `change` event and
// dispatch a setNodeMarkup transaction that updates the `checked`
// attr; we also `preventDefault` on `mousedown` so clicking the
// checkbox doesn't blur the editor (same idiom as the toolbar
// buttons in EditorToolbar.svelte).
//
// `stopEvent` returns true for events targeted at the checkbox so
// ProseMirror doesn't intercept them — that's how `change` reaches
// our listener cleanly.

import type { NodeView, EditorView, ViewMutationRecord } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

export function createTaskItemNodeView(
  initialNode: Node,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let node = initialNode;

  const dom = document.createElement('li');
  dom.setAttribute('data-type', 'task-item');
  dom.setAttribute('data-checked', String(node.attrs['checked']));

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = node.attrs['checked'] === true;
  checkbox.contentEditable = 'false';
  checkbox.setAttribute('data-testid', 'task-checkbox');
  checkbox.addEventListener('mousedown', (e) => {
    // Same as toolbar buttons — don't blur the editor / disturb its
    // selection when the user clicks the checkbox.
    e.preventDefault();
  });
  checkbox.addEventListener('change', () => {
    const pos = getPos();
    if (pos === undefined) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: checkbox.checked,
    });
    view.dispatch(tr);
  });

  const contentDOM = document.createElement('div');
  contentDOM.setAttribute('data-task-content', 'true');

  dom.appendChild(checkbox);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updated): boolean {
      if (updated.type !== node.type) return false;
      node = updated;
      dom.setAttribute('data-checked', String(updated.attrs['checked']));
      checkbox.checked = updated.attrs['checked'] === true;
      return true;
    },
    stopEvent(event): boolean {
      // Let the checkbox's own events through unchanged.
      return event.target === checkbox;
    },
    ignoreMutation(mutation: ViewMutationRecord): boolean {
      // The checkbox's `checked` attribute is mutated by the browser
      // before our `change` listener runs; treat those mutations as
      // not affecting the editor model so PM doesn't try to re-render.
      if (mutation.target === checkbox) return true;
      return false;
    },
  };
}
