<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    room?: string;
    serverUrl?: string;
  }

  let { room, serverUrl = 'ws://127.0.0.1:1234' }: Props = $props();

  let viewEl: HTMLDivElement | null = $state(null);

  // Phase 1 read-only: same y-prosemirror stack as Editor.svelte but with
  // `editable: () => false` and without the undo/keymap plugins. Live
  // updates still arrive via ySyncPlugin so the reader stays current as
  // desktop peers edit.
  let cleanup: (() => void) | null = null;

  onMount(async () => {
    const [Y, { HocuspocusProvider }, { EditorState }, { EditorView }, { schema }, yProsemirror] =
      await Promise.all([
        import('yjs'),
        import('@hocuspocus/provider'),
        import('prosemirror-state'),
        import('prosemirror-view'),
        import('prosemirror-schema-basic'),
        import('y-prosemirror'),
      ]);

    const { ySyncPlugin } = yProsemirror;

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
      plugins: [ySyncPlugin(yXmlFragment)],
    });

    if (viewEl === null) {
      throw new Error('mobile-reader mount point missing');
    }

    const view = new EditorView(viewEl, {
      state,
      editable: () => false,
    });

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
  bind:this={viewEl}
  data-testid="mobile-reader"
  class="reader"
  role="article"
  aria-label="Note body (read-only)"
></div>

<style>
  .reader {
    padding: 1rem;
    background: #fff;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
    min-height: 60vh;
  }

  .reader :global(.ProseMirror) {
    outline: none;
    /* No caret in read-only mode. */
    caret-color: transparent;
  }

  .reader :global(.ProseMirror p) {
    margin: 0 0 0.5rem;
  }
</style>
