// W-009 + W-010 keyboard shortcuts:
//
//   Mod-B          -> toggleMark(strong)
//   Mod-I          -> toggleMark(em)
//   Mod-Shift-X    -> toggleMark(strike)
//   Mod-K          -> open the link popover (no selection = no-op)
//   Space          -> toggle the surrounding task_item's `checked` attr
//                     IF the caret is at position 0 of an empty
//                     task_item (W-010); otherwise falls through to
//                     baseKeymap so a literal space gets typed.
//
// "Mod" means Cmd on Mac and Ctrl elsewhere; prosemirror-keymap
// handles that mapping. The Mod-K command is a pure side-effect:
// it has no transaction to dispatch, it just signals Svelte that the
// popover should open. We follow the standard ProseMirror pattern
// of running the side effect only when `dispatch` is provided so that
// the dry-run "is this command applicable" check (dispatch === undefined)
// doesn't accidentally open the popover.

import type { Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';

export interface EditorKeymapDeps {
  schema: Schema;
  /** Called when Mod-K fires with a non-empty selection. */
  onLinkRequested: () => void;
}

export function buildEditorKeymap(deps: EditorKeymapDeps): Record<string, Command> {
  const { schema, onLinkRequested } = deps;
  const taskItemType = schema.nodes['task_item']!;

  return {
    'Mod-b': toggleMark(schema.marks['strong']!),
    'Mod-i': toggleMark(schema.marks['em']!),
    'Mod-Shift-x': toggleMark(schema.marks['strike']!),
    'Mod-k': (state, dispatch) => {
      if (state.selection.empty) return false;
      if (dispatch !== undefined) {
        onLinkRequested();
      }
      return true;
    },
    Space: (state, dispatch) => {
      // Only intercept Space when the caret is at the very start of
      // an EMPTY task_item; anywhere else return false so baseKeymap
      // (or text input) types a literal space. This matches the spec
      // wording "Space when caret inside" but, narrowed to the empty
      // case so typing inside a populated task_item still works.
      if (!state.selection.empty) return false;
      const { $from } = state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        const ancestor = $from.node(d);
        if (ancestor.type !== taskItemType) continue;
        // Empty content only — once the user has typed text, Space
        // belongs to them.
        if (ancestor.textContent.length !== 0) return false;
        const itemStart = $from.before(d);
        if (dispatch !== undefined) {
          dispatch(
            state.tr.setNodeMarkup(itemStart, undefined, {
              ...ancestor.attrs,
              checked: !(ancestor.attrs['checked'] === true),
            }),
          );
        }
        return true;
      }
      return false;
    },
  };
}
