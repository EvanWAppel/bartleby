<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import EditorToolbar from '$lib/components/EditorToolbar.svelte';
  import type { ToolbarActions } from '$lib/editor/actions';

  interface Props {
    room?: string;
    serverUrl?: string;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234' }: Props = $props();

  let editorEl: HTMLDivElement | null = $state(null);
  let actions: ToolbarActions | null = $state(null);

  // Phase 0: heavy editor modules are dynamically imported so SvelteKit's
  // SSR pass doesn't try to load the DOM-dependent ProseMirror code.
  // The schema module itself is pure data structures (safe in SSR) but
  // we keep it under the same dynamic-import umbrella for consistency.
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

    const state = EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yXmlFragment),
        yUndoPlugin(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
        }),
        keymap(baseKeymap),
      ],
    });

    if (editorEl === null) {
      throw new Error('editor mount point missing');
    }

    const view = new EditorView(editorEl, { state });

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
      toggleLink: (href) => {
        if (href === null) {
          run(toggleMark(markTypes.link));
        } else {
          run(toggleMark(markTypes.link, { href }));
        }
      },
      setHeading: (level) => run(setBlockType(nodeTypes.heading, { level })),
      toggleBulletList: () => run(wrapInList(nodeTypes.bullet_list)),
      toggleOrderedList: () => run(wrapInList(nodeTypes.ordered_list)),
      toggleBlockquote: () => run(wrapIn(nodeTypes.blockquote)),
      toggleCodeBlock: () => run(setBlockType(nodeTypes.code_block)),
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

  .editor :global(.ProseMirror pre) {
    background: #f5f5f5;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    overflow-x: auto;
  }

  .editor :global(.ProseMirror ul),
  .editor :global(.ProseMirror ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  .editor :global(.ProseMirror s) {
    text-decoration: line-through;
  }
</style>
