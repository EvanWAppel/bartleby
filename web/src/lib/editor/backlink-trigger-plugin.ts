// W-012 backlink trigger plugin.
//
// Watches the doc for an active `[[…` typing session: when the user
// types the second `[` of `[[`, the plugin activates and reports the
// trigger position + the live query (text between `[[` and the cursor)
// to Editor.svelte via a callback. Editor.svelte mounts the
// BacklinkPickerPopover off that state and, on apply, dispatches a
// transaction that replaces the `[[query` text with a backlink atom
// node.
//
// We intentionally don't auto-convert when the user types the closing
// `]]`. The S-009 onStoreDocument hook already extracts `[[Title]]`
// from the markdown via regex (derived/backlinks.ts), so a literal
// closing-bracket-style backlink is a valid fallback when the user
// types it whole instead of going through the picker. Auto-converting
// would steal a closing-bracket from someone who meant to type
// `[[not yet decided]]` and finish later.
//
// The plugin doesn't dispatch any transactions; it only reads state
// and signals. The actual `setNodeMarkup`-equivalent replace is done
// by Editor.svelte's onApply handler (via a helper exported below).

import type { Plugin as PMPlugin, EditorState, Transaction } from 'prosemirror-state';
import type { Schema, Node as PMNode } from 'prosemirror-model';

export interface BacklinkTriggerStatus {
  /** Doc position of the first `[` of the active `[[…` trigger. */
  triggerStart: number;
  /** Live query — text between `[[` and the cursor. */
  query: string;
}

export interface BacklinkTriggerDeps {
  schema: Schema;
  /**
   * Fires whenever the trigger transitions in/out of the active state
   * or the query text changes. `null` means "no active trigger".
   */
  onChange: (status: BacklinkTriggerStatus | null) => void;
  /**
   * Fires when the user hits Escape while the trigger is active. We
   * intercept Escape here (rather than in the popover) because the
   * popover stays non-focused — the editor must keep capturing
   * keystrokes so the user can keep typing `[[query` without
   * focus-switching.
   *
   * Per the W-012 cancel-mode decision the parent should close the
   * popover but NOT mutate the doc — the literal `[[query` text stays
   * so the S-009 backlink extractor can still resolve it once the
   * user types `]]`.
   */
  onEscape: () => void;
}

interface TriggerState {
  /** -1 when inactive. */
  triggerStart: number;
}

const INACTIVE: TriggerState = { triggerStart: -1 };

/**
 * Compute the trigger state for the given EditorState. Returns
 * INACTIVE unless the selection is collapsed inside a textblock whose
 * text reads `[[<query>` at or before the cursor — `<query>` may not
 * contain `]`, `[`, or a newline (so closing the brackets or hitting
 * Enter ends the trigger).
 */
function detectTrigger(state: EditorState): TriggerState {
  const { selection } = state;
  if (!selection.empty) return INACTIVE;
  const $from = selection.$from;
  // Only fire inside a textblock (paragraph, heading, etc). Inside a
  // code_block we deliberately stay out of the user's way — `[[` is
  // legitimate syntax in many languages.
  if (!$from.parent.isTextblock) return INACTIVE;
  if ($from.parent.type.spec['code'] === true) return INACTIVE;

  // Walk back from the cursor through this textblock looking for the
  // most-recent `[[` whose query-since (text between `[[` and cursor)
  // doesn't include `]`, `[`, or a newline.
  const parentStart = $from.start();
  const cursorOffset = $from.parentOffset;
  if (cursorOffset < 2) return INACTIVE;
  const text = $from.parent.textContent.slice(0, cursorOffset);
  // Find the latest `[[`.
  const idx = text.lastIndexOf('[[');
  if (idx < 0) return INACTIVE;
  // Query is everything after the `[[`.
  const query = text.slice(idx + 2);
  if (query.includes(']') || query.includes('[') || query.includes('\n')) {
    return INACTIVE;
  }
  return { triggerStart: parentStart + idx };
}

function statusFromState(state: EditorState, trigger: TriggerState): BacklinkTriggerStatus | null {
  if (trigger.triggerStart < 0) return null;
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const start = trigger.triggerStart + 2;
  if ($from.pos <= start) return { triggerStart: trigger.triggerStart, query: '' };
  const query = state.doc.textBetween(start, $from.pos);
  return { triggerStart: trigger.triggerStart, query };
}

export async function buildBacklinkTriggerPlugin(deps: BacklinkTriggerDeps): Promise<PMPlugin> {
  const { schema, onChange, onEscape } = deps;
  // Dynamic-import to match how the other editor plugins ship.
  const { Plugin, PluginKey } = await import('prosemirror-state');
  void schema;
  const key = new PluginKey<TriggerState>('backlink-trigger');

  // Track suppression: when the user hits Escape while the trigger is
  // active, we don't want to keep firing onChange for the same
  // `[[query` they just dismissed. We stash the suppressed
  // triggerStart and treat it as inactive until the doc changes the
  // `[[` characters themselves (delete or retype).
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
        // Mark this trigger as suppressed so the next onChange fires
        // null (popover closes) and stays closed until the user types
        // a fresh `[[`. Re-enables when the suppressed `[[` is
        // deleted or moved past.
        suppressedTriggerStart = status.triggerStart;
        onEscape();
        return true;
      },
    },
    view(view) {
      let last: BacklinkTriggerStatus | null = null;
      function sync(state: EditorState): void {
        const trigger = key.getState(state) ?? INACTIVE;
        let status = statusFromState(state, trigger);
        // Honor the suppression flag from a previous Escape until the
        // suppressed `[[` is no longer the active trigger.
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
 * Build a transaction that replaces the `[[query` text starting at
 * `triggerStart` (up to the current selection head) with a fresh
 * backlink atom node carrying { targetId, title }.
 *
 * Caller is responsible for `view.dispatch(tr)`.
 */
export function buildApplyTransaction(
  state: EditorState,
  triggerStart: number,
  targetId: string,
  title: string,
): Transaction | null {
  const backlinkType = state.schema.nodes['backlink'];
  if (backlinkType === undefined) return null;
  const cursor = state.selection.$from.pos;
  if (cursor <= triggerStart) return null;
  // The node we'll insert. atom + inline so the whole `[[query` span
  // becomes a single non-editable token.
  const node: PMNode = backlinkType.create({ targetId, title });
  return state.tr.replaceWith(triggerStart, cursor, node);
}
