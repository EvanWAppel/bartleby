// W-009 keyboard shortcuts:
//
//   Mod-B          -> toggleMark(strong)
//   Mod-I          -> toggleMark(em)
//   Mod-Shift-X    -> toggleMark(strike)
//   Mod-K          -> open the link popover (no selection = no-op)
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
  };
}
