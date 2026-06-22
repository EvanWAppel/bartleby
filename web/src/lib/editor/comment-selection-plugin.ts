// W-018 comment-trigger plugin.
//
// Watches the editor's selection. When the user has a non-empty text
// selection inside a normal textblock (not a code block — the floating
// "Comment" toolbar would clobber the W-011 language-picker chip), the
// plugin reports the selection's (from, to) range + the text it spans
// to Editor.svelte. The editor mounts FloatingCommentToolbar at the
// selection's coordinates.
//
// Same single-callback pattern as the W-012 backlink trigger plugin
// and W-013 mention trigger plugin: the plugin doesn't dispatch any
// transactions or own UI, it just reports state.

import type { Plugin as PMPlugin, EditorState } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export interface CommentSelectionStatus {
  /** Start of the selection (PM doc pos). */
  from: number;
  /** End of the selection (PM doc pos). */
  to: number;
  /** Selected text, exactly what `original_quote` should hold. */
  text: string;
}

export interface CommentSelectionDeps {
  schema: Schema;
  onChange: (status: CommentSelectionStatus | null) => void;
}

function detect(state: EditorState): CommentSelectionStatus | null {
  const { selection } = state;
  if (selection.empty) return null;
  const $from = selection.$from;
  const $to = selection.$to;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return null;
  // Keep out of code blocks — they have W-011 controls on top and the
  // user's likely typing code, not English worth commenting on yet.
  if ($from.parent.type.spec['code'] === true) return null;
  const text = state.doc.textBetween(selection.from, selection.to, ' ');
  return { from: selection.from, to: selection.to, text };
}

export async function buildCommentSelectionPlugin(deps: CommentSelectionDeps): Promise<PMPlugin> {
  const { schema, onChange } = deps;
  void schema;
  const { Plugin, PluginKey } = await import('prosemirror-state');
  const key = new PluginKey('comment-selection');

  return new Plugin({
    key,
    view(view) {
      let last: CommentSelectionStatus | null = null;
      function sync(state: EditorState): void {
        const status = detect(state);
        const same =
          (last === null && status === null) ||
          (last !== null && status !== null && last.from === status.from && last.to === status.to);
        if (same) return;
        last = status;
        onChange(status);
      }
      sync(view.state);
      return {
        update(v) {
          sync(v.state);
        },
        destroy() {
          if (last !== null) {
            last = null;
            onChange(null);
          }
        },
      };
    },
  });
}
