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
    // Q-006: the mobile reader and the desktop Editor are BOTH mounted
    // on /n/[id] — display is toggled via CSS media queries. That means
    // on desktop, the reader still spins up its own HocuspocusProvider +
    // Y.Doc against the same room as the Editor. Two independent
    // providers in the same room race the sync handshake: the reader's
    // late initial sync can fire a y-prosemirror `_typeChanged` rebuild
    // on the EDITOR's view too (Yjs broadcasts the handshake back), and
    // we've seen the editor's PM doc get visibly clobbered in flight
    // (this was the root cause behind the strike/Mod-Shift-X flakes).
    // The reader has nothing to render on desktop anyway — its container
    // is `display: none` above the mobile breakpoint — so bail out of
    // onMount entirely when we're on a desktop viewport. We use
    // matchMedia (mirroring the same breakpoint as the route's CSS) so
    // the runtime behavior tracks the visual one.
    if (window.matchMedia('(min-width: 768px)').matches) {
      return;
    }

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
