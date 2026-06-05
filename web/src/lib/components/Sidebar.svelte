<script lang="ts">
  // W-004: live notes list + new-note button. Polled every 1s by
  // NotesStore so creates/renames/deletes from other clients land
  // here within a second.
  //
  // The new-note button is a form POSTing to /api/notes/new (a thin
  // SvelteKit server endpoint that calls bartleby's POST /notes and
  // 303s to /n/[new-id]). Form-based intentionally: no-JS works,
  // refreshes are atomic, and we sidestep a flaky Playwright+Svelte 5
  // event-delegation interaction with client-side click handlers.

  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { NotesStore } from '$lib/state/notes-store.svelte';

  interface Props {
    user: { display_name: string; color: string } | null;
  }
  let { user }: Props = $props();

  const store = new NotesStore();

  onMount(() => store.start());
  onDestroy(() => store.stop());

  function isActive(id: string): boolean {
    return page.url.pathname === `/n/${id}`;
  }
</script>

<aside class="sidebar" data-testid="sidebar" aria-label="Notes navigation">
  <header class="brand">
    <h1>Bartleby</h1>
  </header>

  <form method="POST" action="/api/notes/new" data-testid="new-note-form">
    <button class="new" type="submit" data-testid="new-note-button"> + New note </button>
  </form>

  <nav data-testid="notes-list" aria-label="Notes">
    {#if store.loading && store.notes.length === 0}
      <p class="hint">Loading…</p>
    {:else if store.error !== null && store.notes.length === 0}
      <p class="error" role="alert">Couldn't load notes: {store.error}</p>
    {:else if store.notes.length === 0}
      <p class="hint" data-testid="notes-list-empty">No notes yet.</p>
    {:else}
      <ul>
        {#each store.notes as note (note.id)}
          <li>
            <a
              href={`/n/${note.id}`}
              class:active={isActive(note.id)}
              data-testid="notes-list-item"
              data-note-id={note.id}
            >
              {note.title}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </nav>

  {#if user !== null}
    <footer class="who" data-testid="signed-in-user">
      <span class="avatar" style="background-color: {user.color}" aria-hidden="true"></span>
      <span class="name">{user.display_name}</span>
    </footer>
  {/if}
</aside>

<style>
  .sidebar {
    border-right: 1px solid #e0e0e0;
    background: #fafafa;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .brand h1 {
    margin: 0;
    font-size: 1.1rem;
  }

  .new {
    appearance: none;
    border: 1px solid #cfcfcf;
    background: #fff;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    cursor: pointer;
    text-align: left;
  }
  .new:hover {
    background: #f0f0f0;
  }
  .new:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  nav {
    flex: 1;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  li a {
    display: block;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    color: #222;
    text-decoration: none;
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li a:hover {
    background: #ececec;
  }
  li a.active {
    background: #d0e3ff;
    color: #0b3e7f;
    font-weight: 500;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
    margin: 0;
  }

  .error {
    color: #b00020;
    font-size: 0.85rem;
    margin: 0;
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
</style>
