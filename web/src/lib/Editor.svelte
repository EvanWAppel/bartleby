<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import EditorToolbar from '$lib/components/EditorToolbar.svelte';
  import LinkPopover from '$lib/components/LinkPopover.svelte';
  import CodeLangPopover from '$lib/components/CodeLangPopover.svelte';
  import BacklinkPickerPopover from '$lib/components/BacklinkPickerPopover.svelte';
  import MentionPickerPopover from '$lib/components/MentionPickerPopover.svelte';
  import { NotesStore } from '$lib/state/notes-store.svelte';
  import { UsersStore } from '$lib/state/users-store.svelte';
  import type { ToolbarActions } from '$lib/editor/actions';

  interface Props {
    room?: string;
    serverUrl?: string;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234' }: Props = $props();

  let editorEl: HTMLDivElement | null = $state(null);
  let actions: ToolbarActions | null = $state(null);

  // W-012 backlink picker. The trigger plugin reports an active
  // `[[<query>` state via its onChange callback; we mirror that into
  // Svelte $state so the popover mounts/unmounts and re-filters as the
  // user types. The NotesStore polls /notes every 1s so the candidate
  // list is the same one the sidebar shows — no extra server roundtrip.
  let backlinkOpen: boolean = $state(false);
  let backlinkQuery: string = $state('');
  let onBacklinkApply: ((targetId: string, title: string) => void) | null = $state(null);
  let onBacklinkCancel: (() => void) | null = $state(null);
  const notesStore = new NotesStore();

  // W-013 mention picker. Same shape as the backlink picker — the
  // trigger plugin reports an active `@<query>` and we mirror that into
  // Svelte $state so MentionPickerPopover mounts/unmounts. UsersStore
  // fetches /users on a slow poll (operator-edited allowlist, no need
  // for sub-second freshness).
  let mentionOpen: boolean = $state(false);
  let mentionQuery: string = $state('');
  let onMentionApply: ((email: string, displayName: string) => void) | null = $state(null);
  let onMentionCancel: (() => void) | null = $state(null);
  const usersStore = new UsersStore();

  // Link-popover state. Editor.svelte owns the open/closed flag and
  // the captured ProseMirror selection range; the LinkPopover
  // component only knows about a URL string + apply/cancel callbacks
  // that Editor.svelte hands it. The selection has to be captured
  // BEFORE the popover mounts because focusing the URL input would
  // otherwise drop ProseMirror's text selection.
  let linkOpen: boolean = $state(false);
  let onLinkApply: ((href: string) => void) | null = $state(null);
  let onLinkCancel: (() => void) | null = $state(null);

  // W-011 code-block language picker. The NodeView for code_block
  // surfaces a "Lang: <id> ▾" button per block; clicking it asks
  // Editor.svelte to open this popover with the captured block
  // position. Apply dispatches setNodeMarkup against that pos. Same
  // pattern as LinkPopover — Svelte component lives at this layer
  // because the NodeView is plain DOM and can't host Svelte UI.
  let codeLangOpen: boolean = $state(false);
  let codeLangCurrent: string = $state('text');
  let onCodeLangApply: ((lang: string) => void) | null = $state(null);
  let onCodeLangCancel: (() => void) | null = $state(null);

  // Phase 0: heavy editor modules are dynamically imported so SvelteKit's
  // SSR pass doesn't try to load the DOM-dependent ProseMirror code.
  // The schema/keymap/inputrules modules themselves are pure data
  // structures (safe in SSR) but we keep them under the same dynamic-
  // import umbrella for consistency.
  let cleanup: (() => void) | null = null;

  onMount(async () => {
    const [
      Y,
      { HocuspocusProvider },
      { EditorState },
      { EditorView },
      { schema, markTypes, nodeTypes },
      { keymap },
      { baseKeymap, toggleMark, setBlockType, wrapIn },
      { wrapInList },
      { buildEditorKeymap },
      { buildInputRules },
      { createTaskItemNodeView },
      { createCodeBlockNodeViewFactory },
      { buildHighlightPlugin },
      { buildBacklinkTriggerPlugin, buildApplyTransaction: buildBacklinkApplyTx },
      { createBacklinkNodeViewFactory },
      { buildMentionTriggerPlugin, buildApplyTransaction: buildMentionApplyTx },
      { createMentionNodeView },
      yProsemirror,
    ] = await Promise.all([
      import('yjs'),
      import('@hocuspocus/provider'),
      import('prosemirror-state'),
      import('prosemirror-view'),
      import('$lib/editor/schema'),
      import('prosemirror-keymap'),
      import('prosemirror-commands'),
      import('prosemirror-schema-list'),
      import('$lib/editor/keymap'),
      import('$lib/editor/input-rules'),
      import('$lib/editor/task-item-node-view'),
      import('$lib/editor/code-block-node-view'),
      import('$lib/editor/highlight-plugin'),
      import('$lib/editor/backlink-trigger-plugin'),
      import('$lib/editor/backlink-node-view'),
      import('$lib/editor/mention-trigger-plugin'),
      import('$lib/editor/mention-node-view'),
      import('y-prosemirror'),
    ]);

    const { ySyncPlugin, yUndoPlugin, undo, redo } = yProsemirror;

    const resolvedRoom =
      room ?? new URLSearchParams(window.location.search).get('room') ?? 'vertical-slice';

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: serverUrl,
      name: resolvedRoom,
      document: ydoc,
    });

    const yXmlFragment = ydoc.getXmlFragment('prosemirror');

    // Captured selection for the link popover. We grab the live view's
    // selection at the moment the popover opens and replay it onto an
    // addMark transaction when the user submits.
    let savedSelection: { from: number; to: number } | null = null;

    function captureSelection(): void {
      const sel = view.state.selection;
      if (sel.empty) return;
      savedSelection = { from: sel.from, to: sel.to };
      linkOpen = true;
    }

    const editorKeymap = buildEditorKeymap({
      schema,
      onLinkRequested: captureSelection,
    });

    // W-011 code-block language picker. The NodeView signals which
    // code_block the user clicked via its pos; we capture that here so
    // apply/cancel can dispatch against the right node even if the
    // selection drifts in the meantime.
    let codeLangSavedPos: number | null = null;
    function requestCodeLang(pos: number, currentLang: string): void {
      codeLangSavedPos = pos;
      codeLangCurrent = currentLang;
      codeLangOpen = true;
    }

    // W-011 highlight plugin is async (it dynamic-imports Shiki on
    // first use). We await it BEFORE creating EditorState so it sits
    // in the plugin list from the start; the alternative — reconfigure
    // mid-flight — would require dispatching a state.reconfigure tx
    // that y-prosemirror's ySyncPlugin doesn't tolerate well.
    const highlightPlugin = await buildHighlightPlugin({ schema });

    // W-012 backlink trigger plugin. The plugin watches doc state for
    // an active `[[<query>` typing session and signals via onChange;
    // we mirror that into Svelte $state so the popover mounts and
    // re-filters as the user types. `backlinkTriggerStart` is captured
    // here so the apply transaction can replace the right range even
    // if the cursor wanders before the user clicks a candidate.
    let backlinkTriggerStart: number | null = null;
    const backlinkTriggerPlugin = await buildBacklinkTriggerPlugin({
      schema,
      onChange(status) {
        if (status === null) {
          backlinkTriggerStart = null;
          backlinkOpen = false;
          backlinkQuery = '';
          return;
        }
        backlinkTriggerStart = status.triggerStart;
        backlinkQuery = status.query;
        backlinkOpen = true;
      },
      onEscape() {
        // Closing only — the plugin handles the suppression bookkeeping
        // so the popover stays closed until the user types a fresh
        // `[[`. Per W-012 cancel mode the doc is left untouched.
        backlinkOpen = false;
      },
    });

    // W-013 mention trigger plugin. Same shape as the backlink plugin —
    // the plugin reports `@<query>` activity via onChange; we mirror it
    // into Svelte $state for the popover to consume. mentionTriggerStart
    // is captured so the apply transaction can replace the right range
    // even if the cursor moves.
    let mentionTriggerStart: number | null = null;
    const mentionTriggerPlugin = await buildMentionTriggerPlugin({
      schema,
      onChange(status) {
        if (status === null) {
          mentionTriggerStart = null;
          mentionOpen = false;
          mentionQuery = '';
          return;
        }
        mentionTriggerStart = status.triggerStart;
        mentionQuery = status.query;
        mentionOpen = true;
      },
      onEscape() {
        // Closing only; the plugin's suppression bookkeeping keeps the
        // popover dormant until the user types a fresh `@`. No doc
        // mutation — the literal `@query` text stays.
        mentionOpen = false;
      },
    });

    const state = EditorState.create({
      schema,
      plugins: [
        buildInputRules(schema),
        ySyncPlugin(yXmlFragment),
        yUndoPlugin(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
        }),
        keymap(editorKeymap),
        keymap(baseKeymap),
        highlightPlugin,
        backlinkTriggerPlugin,
        mentionTriggerPlugin,
      ],
    });

    if (editorEl === null) {
      throw new Error('editor mount point missing');
    }

    const view = new EditorView(editorEl, {
      state,
      nodeViews: {
        task_item: createTaskItemNodeView,
        code_block: createCodeBlockNodeViewFactory({ onRequest: requestCodeLang }),
        backlink: createBacklinkNodeViewFactory({
          navigate: (path) => {
            void goto(path);
          },
        }),
        mention: createMentionNodeView,
      },
    });

    // Every toolbar action follows the same shape: read the live view
    // state, dispatch the resulting transaction (if the command was
    // applicable), and re-focus the editor so the user can keep
    // typing. ProseMirror commands return false when not applicable;
    // we deliberately ignore that — a no-op click is fine, the spec
    // is only "produces the right node/mark when applicable".
    type EditorCommand = (s: typeof view.state, dispatch?: typeof view.dispatch) => boolean;
    function run(cmd: EditorCommand): void {
      cmd(view.state, view.dispatch);
      view.focus();
    }

    actions = {
      toggleBold: () => run(toggleMark(markTypes.strong)),
      toggleItalic: () => run(toggleMark(markTypes.em)),
      toggleStrike: () => run(toggleMark(markTypes.strike)),
      openLinkPopover: captureSelection,
      setHeading: (level) => run(setBlockType(nodeTypes.heading, { level })),
      toggleBulletList: () => run(wrapInList(nodeTypes.bullet_list)),
      toggleOrderedList: () => run(wrapInList(nodeTypes.ordered_list)),
      toggleBlockquote: () => run(wrapIn(nodeTypes.blockquote)),
      toggleCodeBlock: () => run(setBlockType(nodeTypes.code_block)),
    };

    onLinkApply = (href) => {
      if (savedSelection !== null) {
        const { from, to } = savedSelection;
        const tr = view.state.tr.addMark(from, to, markTypes.link.create({ href }));
        view.dispatch(tr);
      }
      linkOpen = false;
      savedSelection = null;
      view.focus();
    };

    onLinkCancel = () => {
      linkOpen = false;
      savedSelection = null;
      view.focus();
    };

    onCodeLangApply = (lang) => {
      if (codeLangSavedPos !== null) {
        const pos = codeLangSavedPos;
        const node = view.state.doc.nodeAt(pos);
        if (node !== null && node.type === nodeTypes.code_block) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            language: lang,
          });
          view.dispatch(tr);
        }
      }
      codeLangOpen = false;
      codeLangSavedPos = null;
      view.focus();
    };

    onCodeLangCancel = () => {
      codeLangOpen = false;
      codeLangSavedPos = null;
      view.focus();
    };

    onBacklinkApply = (targetId, title) => {
      if (backlinkTriggerStart !== null) {
        const tr = buildBacklinkApplyTx(view.state, backlinkTriggerStart, targetId, title);
        if (tr !== null) {
          view.dispatch(tr);
        }
      }
      // Closing/clearing state is handled by the trigger plugin's
      // onChange (the replace makes the [[…] vanish), but reset
      // optimistically in case the tx was a no-op.
      backlinkOpen = false;
      backlinkTriggerStart = null;
      backlinkQuery = '';
      view.focus();
    };

    onBacklinkCancel = () => {
      // W-012 cancel mode: leave the literal `[[query` in place. The
      // S-009 backlink extractor will still resolve it server-side
      // once the user types `]]`. We only close the popover and stop
      // tracking; deliberately do NOT mutate the doc.
      backlinkOpen = false;
      view.focus();
    };

    onMentionApply = (email, displayName) => {
      if (mentionTriggerStart !== null) {
        const tr = buildMentionApplyTx(view.state, mentionTriggerStart, email, displayName);
        if (tr !== null) {
          view.dispatch(tr);
        }
      }
      mentionOpen = false;
      mentionTriggerStart = null;
      mentionQuery = '';
      view.focus();
    };

    onMentionCancel = () => {
      // Same cancel-mode pattern as backlinks: close the popover, leave
      // the literal `@query` text in place. No derived-state extractor
      // cares about loose `@`s in v1 — M-001 only acts on mention nodes,
      // not raw `@email` strings.
      mentionOpen = false;
      view.focus();
    };

    notesStore.start();
    usersStore.start();

    cleanup = () => {
      view.destroy();
      provider.destroy();
      ydoc.destroy();
      notesStore.stop();
      usersStore.stop();
    };
  });

  onDestroy(() => {
    cleanup?.();
  });
</script>

{#if actions}
  <EditorToolbar {actions} />
{/if}
{#if linkOpen && onLinkApply && onLinkCancel}
  <LinkPopover onApply={onLinkApply} onCancel={onLinkCancel} />
{/if}
{#if codeLangOpen && onCodeLangApply && onCodeLangCancel}
  <CodeLangPopover
    currentLanguage={codeLangCurrent}
    onApply={onCodeLangApply}
    onCancel={onCodeLangCancel}
  />
{/if}
{#if backlinkOpen && onBacklinkApply && onBacklinkCancel}
  <BacklinkPickerPopover
    query={backlinkQuery}
    notes={notesStore.notes}
    excludeNoteId={room ?? ''}
    onApply={onBacklinkApply}
    onCancel={onBacklinkCancel}
  />
{/if}
{#if mentionOpen && onMentionApply && onMentionCancel}
  <MentionPickerPopover
    query={mentionQuery}
    users={usersStore.users}
    onApply={onMentionApply}
    onCancel={onMentionCancel}
  />
{/if}
<div
  bind:this={editorEl}
  data-testid="editor"
  class="editor"
  role="textbox"
  aria-label="Note body"
  tabindex="0"
></div>

<style>
  .editor {
    border: 1px solid #ccc;
    border-radius: 0 0 6px 6px;
    padding: 1rem;
    min-height: 12rem;
    background: #fff;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
  }

  .editor :global(.ProseMirror) {
    outline: none;
    min-height: 10rem;
  }

  .editor :global(.ProseMirror p) {
    margin: 0 0 0.5rem;
  }

  .editor :global(.ProseMirror h1) {
    font-size: 1.6rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror h2) {
    font-size: 1.35rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror h3) {
    font-size: 1.15rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror blockquote) {
    border-left: 3px solid #ccc;
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: #555;
  }

  /* W-011 code block. The NodeView nests a <button class="code-lang-button">
     + a <code> contentDOM inside the <pre>; we relative-position the
     pre so the button can absolute-position itself in the corner
     without escaping the block. The button text is rendered by the
     NodeView (not a Svelte component) so the user sees "ts ▾" etc. */
  .editor :global(.ProseMirror pre) {
    position: relative;
    background: #f5f5f5;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    overflow-x: auto;
  }

  .editor :global(.ProseMirror pre > .code-lang-button) {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    appearance: none;
    border: 1px solid #ddd;
    background: #fff;
    color: #555;
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    font-size: 0.75rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    cursor: pointer;
    z-index: 1;
  }

  .editor :global(.ProseMirror pre > .code-lang-button:hover) {
    border-color: #5b8def;
    color: #333;
  }

  .editor :global(.ProseMirror ul),
  .editor :global(.ProseMirror ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror s) {
    text-decoration: line-through;
  }

  /* W-012 backlink. Renders as a brackety-blue clickable link with no
     underline by default — Notion/Obsidian convention. cursor:pointer
     reinforces that plain click navigates rather than positions the
     cursor (the NodeView intercepts the click). */
  .editor :global(.ProseMirror a[data-backlink]) {
    color: #5b8def;
    background: rgba(91, 141, 239, 0.08);
    padding: 0 0.15rem;
    border-radius: 3px;
    text-decoration: none;
    cursor: pointer;
  }

  .editor :global(.ProseMirror a[data-backlink]:hover) {
    background: rgba(91, 141, 239, 0.18);
    text-decoration: underline;
  }

  /* W-013 mention. Inert chip — no click handler, just a styled span
     that reads as @-prefixed text. Slightly different palette from the
     backlink (warmer) so the two feel distinct at a glance. */
  .editor :global(.ProseMirror span[data-mention]) {
    color: #a0571c;
    background: rgba(160, 87, 28, 0.08);
    padding: 0 0.15rem;
    border-radius: 3px;
    font-weight: 500;
  }

  /* W-010 task list styling. The <li> renders a checkbox + content;
     the bullet is suppressed and the checkbox sits inline with the
     paragraph. Checked items get a strikethrough on the visible
     content so completed work reads as such. */
  .editor :global(.ProseMirror ul[data-type='task-list']) {
    list-style: none;
    padding-left: 0.5rem;
  }

  .editor :global(.ProseMirror li[data-type='task-item']) {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin: 0.2rem 0;
  }

  .editor :global(.ProseMirror li[data-type='task-item'] > input[type='checkbox']) {
    flex: 0 0 auto;
    margin-top: 0.25rem;
    cursor: pointer;
  }

  .editor :global(.ProseMirror li[data-type='task-item'] > [data-task-content]) {
    flex: 1;
  }

  .editor
    :global(.ProseMirror li[data-type='task-item'][data-checked='true'] > [data-task-content]) {
    text-decoration: line-through;
    color: #888;
  }
</style>
