<script lang="ts">
  // W-003 app shell. Sidebar (W-004) lives in its own component; the
  // right pane (W-015) renders NoteRightPane on /n/[id] and a generic
  // hint elsewhere — the tabs (Comments / Backlinks / History) only
  // make sense in the context of a single note.

  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import Sidebar from './Sidebar.svelte';
  import NoteRightPane from './NoteRightPane.svelte';

  interface Props {
    user: { display_name: string; color: string } | null;
    children: Snippet;
  }

  let { user, children }: Props = $props();

  let currentNoteId = $derived(typeof page.params['id'] === 'string' ? page.params['id'] : null);
</script>

<div class="shell" data-testid="app-shell">
  <Sidebar {user} />

  <main class="main" data-testid="main-pane">
    {@render children()}
  </main>

  <aside class="rightpane" data-testid="right-pane" aria-label="Note details">
    {#if currentNoteId !== null}
      <!-- {#key currentNoteId} forces remount on /n/a → /n/b so
           NoteRightPane re-reads localStorage with the new noteId. -->
      {#key currentNoteId}
        <NoteRightPane noteId={currentNoteId} />
      {/key}
    {:else}
      <p class="hint">Open a note to see comments, backlinks, and history.</p>
    {/if}
  </aside>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 16rem 1fr 18rem;
    height: 100vh;
    font-family: system-ui, sans-serif;
  }

  .main {
    overflow: auto;
    padding: 1.5rem;
  }

  .rightpane {
    border-left: 1px solid #e0e0e0;
    background: #fafafa;
    padding: 1rem;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
  }

  @media (max-width: 767px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .rightpane {
      display: none;
    }
  }
</style>
