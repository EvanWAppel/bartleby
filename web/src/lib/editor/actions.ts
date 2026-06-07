// Shape of the toolbar action bag. Editor.svelte builds the concrete
// callbacks once the EditorView is mounted (each one closes over
// `view` + `view.dispatch` + ProseMirror command helpers) and hands
// the bag to EditorToolbar.svelte.
//
// Kept in its own module so both Svelte components can import the
// type without one importing the other.

export interface ToolbarActions {
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrike: () => void;
  /**
   * Open the link popover. The popover is owned by Editor.svelte;
   * this action only signals "user wants to add a link to the
   * current selection." Empty selection: no-op. Replaces the W-008
   * window.prompt-based `toggleLink` action.
   */
  openLinkPopover: () => void;
  setHeading: (level: 1 | 2 | 3) => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  toggleBlockquote: () => void;
  toggleCodeBlock: () => void;
}
