// W-013 mention trigger plugin.
//
// Watches the doc for an active `@<query>` typing session: when the
// user types `@` at the start of a word (preceded by start-of-block or
// whitespace), the plugin activates and reports the trigger position +
// the live query to Editor.svelte via a callback. Editor.svelte mounts
// the MentionPickerPopover off that state and, on apply, dispatches a
// transaction that replaces the `@query` text with a mention atom
// node.
//
// The plugin doesn't dispatch any transactions; it only reads state
// and signals. The actual replace is done by Editor.svelte's onApply
// handler (via a helper exported below).
//
// Same structural pattern as backlink-trigger-plugin.ts; the differences
// are:
//   - single-char trigger (`@`) instead of `[[`, so we need to be more
//     careful that `@` is not mid-word (e.g., inside `foo@bar.com` the
//     user has typed when no picker should open).
//   - the cancel path on Escape just closes the popover; the literal
//     `@query` text stays in the doc, which is harmless (no derived-
//     state extractor cares about loose `@`s in v1 — M-001 only acts
//     on mention nodes).
//   - code blocks are out of scope, same as backlinks.
//
// Trigger rules:
//   - selection collapsed, cursor inside a textblock (not code_block).
//   - cursor is preceded (eventually) by `@`.
//   - the char immediately before `@` is start-of-textblock OR whitespace
//     OR another delimiter that wouldn't read as "mid-word" (we accept
//     space + tab + newline only; tightening matches Slack/Notion).
//   - the text from `@` to cursor (the query) contains no whitespace,
//     no `@`, no newline — typing a space/newline ends the trigger.

import type { Plugin as PMPlugin, EditorState, Transaction } from 'prosemirror-state';
import type { Schema, Node as PMNode } from 'prosemirror-model';

export interface MentionTriggerStatus {
  /** Doc position of the `@` character. */
  triggerStart: number;
  /** Live query — text between `@` and the cursor. */
  query: string;
}

export interface MentionTriggerDeps {
  schema: Schema;
  onChange: (status: MentionTriggerStatus | null) => void;
  onEscape: () => void;
}

interface TriggerState {
  /** -1 when inactive. */
  triggerStart: number;
}

const INACTIVE: TriggerState = { triggerStart: -1 };

function isStartBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return ch === ' ' || ch === '\t' || ch === '\n';
}

function detectTrigger(state: EditorState): TriggerState {
  const { selection } = state;
  if (!selection.empty) return INACTIVE;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return INACTIVE;
  if ($from.parent.type.spec['code'] === true) return INACTIVE;

  const parentStart = $from.start();
  const cursorOffset = $from.parentOffset;
  if (cursorOffset < 1) return INACTIVE;
  const text = $from.parent.textContent.slice(0, cursorOffset);

  // Walk back from the cursor and find the latest `@` such that:
  //   - the char before `@` is a start boundary,
  //   - the chars between `@` and the cursor are all non-whitespace,
  //     non-`@`, non-newline.
  const atIdx = text.lastIndexOf('@');
  if (atIdx < 0) return INACTIVE;
  const before = atIdx === 0 ? undefined : text.charAt(atIdx - 1);
  if (!isStartBoundary(before)) return INACTIVE;
  const query = text.slice(atIdx + 1);
  if (query.includes(' ') || query.includes('\t') || query.includes('\n') || query.includes('@')) {
    return INACTIVE;
  }
  return { triggerStart: parentStart + atIdx };
}

function statusFromState(state: EditorState, trigger: TriggerState): MentionTriggerStatus | null {
  if (trigger.triggerStart < 0) return null;
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const start = trigger.triggerStart + 1;
  if ($from.pos <= start) return { triggerStart: trigger.triggerStart, query: '' };
  const query = state.doc.textBetween(start, $from.pos);
  return { triggerStart: trigger.triggerStart, query };
}

export async function buildMentionTriggerPlugin(deps: MentionTriggerDeps): Promise<PMPlugin> {
  const { schema, onChange, onEscape } = deps;
  const { Plugin, PluginKey } = await import('prosemirror-state');
  void schema;
  const key = new PluginKey<TriggerState>('mention-trigger');

  // Same Escape-suppression bookkeeping as the backlink plugin: once
  // the user dismisses the popover for a given `@` position, stay
  // closed until they type a fresh `@`.
  let suppressedTriggerStart: number | null = null;

  return new Plugin<TriggerState>({
    key,
    state: {
      init(_config, state: EditorState): TriggerState {
        return detectTrigger(state);
      },
      apply(
        _tr: Transaction,
        _value: TriggerState,
        _old: EditorState,
        newState: EditorState,
      ): TriggerState {
        return detectTrigger(newState);
      },
    },
    props: {
      handleKeyDown(view, event: KeyboardEvent): boolean {
        if (event.key !== 'Escape') return false;
        const trigger = key.getState(view.state) ?? INACTIVE;
        const status = statusFromState(view.state, trigger);
        if (status === null) return false;
        suppressedTriggerStart = status.triggerStart;
        onEscape();
        return true;
      },
    },
    view(view) {
      let last: MentionTriggerStatus | null = null;
      function sync(state: EditorState): void {
        const trigger = key.getState(state) ?? INACTIVE;
        let status = statusFromState(state, trigger);
        if (status !== null && suppressedTriggerStart === status.triggerStart) {
          status = null;
        } else if (
          status === null ||
          (status !== null && status.triggerStart !== suppressedTriggerStart)
        ) {
          suppressedTriggerStart = null;
        }
        const same =
          (last === null && status === null) ||
          (last !== null &&
            status !== null &&
            last.triggerStart === status.triggerStart &&
            last.query === status.query);
        if (same) return;
        last = status;
        onChange(status);
      }
      sync(view.state);
      return {
        update(updatedView, _prev: EditorState): void {
          sync(updatedView.state);
        },
        destroy(): void {
          if (last !== null) {
            last = null;
            onChange(null);
          }
        },
      };
    },
  });
}

/**
 * Build a transaction that replaces the `@query` text starting at
 * `triggerStart` (up to the current selection head) with a fresh
 * mention atom node carrying { email, displayName }.
 *
 * Caller is responsible for `view.dispatch(tr)`.
 */
export function buildApplyTransaction(
  state: EditorState,
  triggerStart: number,
  email: string,
  displayName: string,
): Transaction | null {
  const mentionType = state.schema.nodes['mention'];
  if (mentionType === undefined) return null;
  const cursor = state.selection.$from.pos;
  if (cursor <= triggerStart) return null;
  const node: PMNode = mentionType.create({ email, displayName });
  return state.tr.replaceWith(triggerStart, cursor, node);
}
