<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import EditorToolbar from '$lib/components/EditorToolbar.svelte';
  import LinkPopover from '$lib/components/LinkPopover.svelte';
  import CodeLangPopover from '$lib/components/CodeLangPopover.svelte';
  import type { ToolbarActions } from '$lib/editor/actions';

  interface Props {
    room?: string;
    serverUrl?: string;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234' }: Props = $props();

  let editorEl: HTMLDivElement | null = $state(null);
  let actions: ToolbarActions | null = $state(null);

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

    cleanup = () => {
      view.destroy();
      provider.destroy();
      ydoc.destroy();
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
