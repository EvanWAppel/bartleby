// W-009 markdown-style autocomplete via prosemirror-inputrules.
// Each rule's regexp is anchored at the block start (the inputrules
// machinery only feeds text within the current textblock), so triggers
// like "# " mid-line stay literal — matching the spec's "on empty
// line" wording.
//
// Trigger table:
//
//   "# " / "## " / "### "  -> heading (level = number of hashes)
//   "- " / "+ " / "* "     -> bullet_list
//   "1. "                  -> ordered_list (with the start order)
//   "> "                   -> blockquote

import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

export function buildInputRules(schema: Schema): Plugin {
  const headingType = schema.nodes['heading']!;
  const bulletListType = schema.nodes['bullet_list']!;
  const orderedListType = schema.nodes['ordered_list']!;
  const blockquoteType = schema.nodes['blockquote']!;

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
    ],
  });
}
