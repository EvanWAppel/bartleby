<script lang="ts">
  // W-003 app shell — three-pane skeleton on desktop, single-column
  // on mobile. Sidebar contents come from W-004; right pane contents
  // from W-015 (tabs). For PR 1 they're empty placeholders.

  import type { Snippet } from 'svelte';

  interface Props {
    /** Authed user (passed by +layout.svelte). null on /login etc. */
    user: { display_name: string; color: string } | null;
    /** Main pane content (the active note's editor, the empty state, etc.). */
    children: Snippet;
  }

  let { user, children }: Props = $props();
</script>

<div class="shell" data-testid="app-shell">
  <aside class="sidebar" data-testid="sidebar" aria-label="Notes navigation">
    <header class="brand">
      <h1>Bartleby</h1>
    </header>
    <nav class="placeholder">
      <p class="hint">Notes list lands in W-004.</p>
    </nav>
    {#if user !== null}
      <footer class="who" data-testid="signed-in-user">
        <span class="avatar" style="background-color: {user.color}" aria-hidden="true"></span>
        <span class="name">{user.display_name}</span>
      </footer>
    {/if}
  </aside>

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

  .sidebar {
    border-right: 1px solid #e0e0e0;
    background: #fafafa;
    padding: 1rem;
    display: flex;
    flex-direction: column;
  }

  .brand h1 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
  }

  .placeholder {
    flex: 1;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e0e0e0;
    font-size: 0.85rem;
  }

  .avatar {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    flex-shrink: 0;
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

  /* Mobile: single column, hide the side panes for now. The mobile
     read-only flow (X) handles /n/[id] separately. */
  @media (max-width: 767px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .sidebar,
    .rightpane {
      display: none;
    }
  }
</style>
