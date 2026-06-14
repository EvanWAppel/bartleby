// W-009 + W-010 markdown-style autocomplete via prosemirror-inputrules.
// Each rule's regexp is anchored at the block start (the inputrules
// machinery only feeds text within the current textblock), so triggers
// like "# " mid-line stay literal — matching the spec's "on empty
// line" wording.
//
// Trigger table:
//
//   "# " / "## " / "### "    -> heading (level = number of hashes)
//   "- "  / "+ " / "* "      -> bullet_list
//   "1. "                    -> ordered_list (with the start order)
//   "> "                     -> blockquote
//   "[ ] " / "[x] " inside
//     a single-item
//     bullet_list             -> promote to task_list / task_item (W-010)
//
// Why a promotion step instead of a direct "- [ ] " rule: the bullet
// list rule fires on "- " (which happens *before* the user can finish
// typing "[ ] "), so the only correct way to get a task list via
// keyboard is to let bullet_list fire first and then promote it when
// the bracket pattern lands inside its first (only) item.

import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { Fragment, type NodeType, type Schema } from 'prosemirror-model';
import type { Plugin, EditorState, Transaction } from 'prosemirror-state';

function makePromoteToTaskRule(
  bulletListType: NodeType,
  listItemType: NodeType,
  taskListType: NodeType,
  taskItemType: NodeType,
): InputRule {
  return new InputRule(
    /^\[([ xX])\]\s$/,
    (state: EditorState, match, start: number, end: number): Transaction | null => {
      const $start = state.doc.resolve(start);
      // Walk up looking for a list_item; bail if we don't find one or
      // its parent isn't a bullet_list (we don't promote ordered lists).
      let listItemDepth = -1;
      for (let d = $start.depth; d >= 0; d--) {
        if ($start.node(d).type === listItemType) {
          listItemDepth = d;
          break;
        }
      }
      if (listItemDepth < 1) return null;
      const bulletListDepth = listItemDepth - 1;
      const bulletList = $start.node(bulletListDepth);
      if (bulletList.type !== bulletListType) return null;
      // Only promote when this is the only item — that's the case
      // immediately after the `- ` autocomplete created the list. We
      // refuse to promote an established multi-item bullet list since
      // that would silently demote the existing items.
      if (bulletList.childCount !== 1) return null;

      const flag = (match[1] ?? ' ').toLowerCase();
      const checked = flag === 'x';

      // Build a fresh task_list with the (post-bracket-deletion)
      // paragraph content and replaceWith the bullet_list in one shot.
      // Using setNodeMarkup at either level doesn't work because each
      // step's content validation rejects the half-converted tree;
      // building the replacement node fully assembled is the only
      // way the transaction stays valid through the dispatch.
      const listItem = $start.node(listItemDepth);
      const paragraph = listItem.firstChild;
      if (paragraph === null) return null;
      const cleanedTextblockContent = paragraph.content.cut(end - start);
      const newParagraph = paragraph.type.create(paragraph.attrs, cleanedTextblockContent);
      const newTaskItem = taskItemType.create({ checked }, Fragment.from(newParagraph));
      const newTaskList = taskListType.create(null, Fragment.from(newTaskItem));
      const bulletListPos = $start.before(bulletListDepth);
      const bulletListEnd = bulletListPos + bulletList.nodeSize;
      return state.tr.replaceWith(bulletListPos, bulletListEnd, newTaskList);
    },
  );
}

export function buildInputRules(schema: Schema): Plugin {
  const headingType = schema.nodes['heading']!;
  const bulletListType = schema.nodes['bullet_list']!;
  const orderedListType = schema.nodes['ordered_list']!;
  const blockquoteType = schema.nodes['blockquote']!;
  const listItemType = schema.nodes['list_item']!;
  const taskListType = schema.nodes['task_list']!;
  const taskItemType = schema.nodes['task_item']!;

  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, headingType, (match) => ({
        level: (match[1] ?? '').length,
      })),
      wrappingInputRule(/^\s*([-+*])\s$/, bulletListType),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedListType,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + (node.attrs['order'] as number) === Number(match[1]),
      ),
      wrappingInputRule(/^\s*>\s$/, blockquoteType),
      // Must come AFTER the bullet rule — see the header comment.
      makePromoteToTaskRule(bulletListType, listItemType, taskListType, taskItemType),
    ],
  });
}
