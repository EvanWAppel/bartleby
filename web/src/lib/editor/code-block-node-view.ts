// W-011 NodeView for code_block: renders an editable <pre><code>...</code></pre>
// plus a small "Lang: <id> ▾" button positioned in the top-right corner
// that opens the CodeLangPopover. Mirrors the pattern from
// task-item-node-view.ts (W-010).
//
// The button is `contenteditable=false` so ProseMirror doesn't try to
// place a cursor inside it; mousedown is preventDefault'd so clicking
// it doesn't blur the editor (same idiom as the toolbar buttons in
// EditorToolbar.svelte). `stopEvent` returns true for events targeted
// at the button so ProseMirror leaves the click alone and our handler
// fires cleanly.
//
// The actual popover state lives in Editor.svelte — the NodeView
// signals "user wants to pick a language for THIS code_block" via
// onRequest(pos, currentLanguage); Editor.svelte then mounts the
// popover and, on apply, dispatches setNodeMarkup against the captured
// pos. We can't dispatch from inside the NodeView's button click
// directly because we'd need to render a Svelte popover, which the
// NodeView (plain DOM) can't own.

import type { NodeView, EditorView, ViewMutationRecord } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { labelForLanguage } from './code-languages.js';

export interface CodeBlockNodeViewDeps {
  /** Called when the user clicks the language button on this block. */
  onRequest: (pos: number, currentLanguage: string) => void;
}

export function createCodeBlockNodeViewFactory(deps: CodeBlockNodeViewDeps) {
  return (initialNode: Node, view: EditorView, getPos: () => number | undefined): NodeView => {
    let node = initialNode;

    const dom = document.createElement('pre');
    dom.setAttribute('data-language', String(node.attrs['language']));

    const button = document.createElement('button');
    button.type = 'button';
    button.contentEditable = 'false';
    button.setAttribute('data-testid', 'code-lang-button');
    button.className = 'code-lang-button';
    button.textContent = `${labelForLanguage(String(node.attrs['language']))} ▾`;
    button.addEventListener('mousedown', (e) => {
      // Don't blur the editor — Editor.svelte needs the live view's
      // state (and getPos()) to be intact when it dispatches the
      // setNodeMarkup transaction.
      e.preventDefault();
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      deps.onRequest(pos, String(view.state.doc.nodeAt(pos)?.attrs['language'] ?? 'text'));
    });

    const contentDOM = document.createElement('code');

    dom.appendChild(button);
    dom.appendChild(contentDOM);

    return {
      dom,
      contentDOM,
      update(updated): boolean {
        if (updated.type !== node.type) return false;
        node = updated;
        const lang = String(updated.attrs['language']);
        dom.setAttribute('data-language', lang);
        button.textContent = `${labelForLanguage(lang)} ▾`;
        return true;
      },
      stopEvent(event): boolean {
        // Let the button's events through unchanged so PM doesn't
        // try to position a cursor over it.
        return event.target === button;
      },
      ignoreMutation(mutation: ViewMutationRecord): boolean {
        // The button is dynamically labeled by update(); any mutation
        // PM sees on it is ours, not user input.
        if (mutation.target === button) return true;
        return false;
      },
    };
  };
}
