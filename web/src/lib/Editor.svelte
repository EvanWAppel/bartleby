<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    room?: string;
    serverUrl?: string;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234' }: Props = $props();

  let editorEl: HTMLDivElement | null = $state(null);

  // Phase 0: heavy editor modules are dynamically imported so SvelteKit's
  // SSR pass doesn't try to load the DOM-dependent ProseMirror code.
  let cleanup: (() => void) | null = null;

  onMount(async () => {
    const [
      Y,
      { HocuspocusProvider },
      { EditorState },
      { EditorView },
      { schema },
      { keymap },
      { baseKeymap },
      yProsemirror,
    ] = await Promise.all([
      import('yjs'),
      import('@hocuspocus/provider'),
      import('prosemirror-state'),
      import('prosemirror-view'),
      import('prosemirror-schema-basic'),
      import('prosemirror-keymap'),
      import('prosemirror-commands'),
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
    border-radius: 6px;
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
</style>
