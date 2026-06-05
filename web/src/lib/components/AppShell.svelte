<script lang="ts">
  // W-003 app shell. Sidebar (W-004) now lives in its own component
  // so it can own its polling state. Right pane content (W-015 tabs)
  // is still a placeholder.

  import type { Snippet } from 'svelte';
  import Sidebar from './Sidebar.svelte';

  interface Props {
    user: { display_name: string; color: string } | null;
    children: Snippet;
  }

  let { user, children }: Props = $props();
</script>

<div class="shell" data-testid="app-shell">
  <Sidebar {user} />

  <main class="main" data-testid="main-pane">
    {@render children()}
  </main>

  <aside class="rightpane" data-testid="right-pane" aria-label="Note details">
    <p class="hint">Comments / Backlinks / History tabs land in W-015.</p>
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
