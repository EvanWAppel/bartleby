<script lang="ts">
  // W-004 sidebar: live notes list + new-note button. Polled every 1s
  // by NotesStore so creates/renames/deletes from other clients land
  // here within a second.
  //
  // W-021 layers tag-filter chips on top of the list. We do the
  // filtering client-side off the polled NotesStore — the server's
  // ?tag filter would work too, but client-side keeps the chip set
  // stable (filtering shrinks the visible list, but the chips still
  // need to show OTHER tags so the user can switch filters; pulling
  // both filtered + unfiltered lists every second would double the
  // poll cost). Click cycles: click a chip to filter, click the same
  // chip again to clear.
  //
  // The new-note button is a form POSTing to /api/notes/new (a thin
  // SvelteKit server endpoint that calls bartleby's POST /notes and
  // 303s to /n/[new-id]). Form-based intentionally: no-JS works,
  // refreshes are atomic, and we sidestep a flaky Playwright+Svelte 5
  // event-delegation interaction with client-side click handlers.

  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { NotesStore } from '$lib/state/notes-store.svelte';
  import { MentionsStore } from '$lib/state/mentions-store.svelte';

  interface Props {
    user: { display_name: string; color: string } | null;
  }
  let { user }: Props = $props();

  const store = new NotesStore();
  // W-023 unread-mentions badge. Polls on a 5s cadence (mentions are
  // not high-frequency) — clicking a row in /inbox marks it read via
  // POST /mentions/:id/read and the next poll clears the badge.
  const mentions = new MentionsStore();

  let activeTag: string | null = $state(null);

  // Union of all tags across every note, sorted lowercase. Recomputes
  // when the store's `notes` array changes. We sort + lowercase the
  // display alphabetically rather than by tag-frequency or recency to
  // keep the chip order stable across polls — a chip that jumps around
  // mid-click would be miserable to use.
  const availableTags: string[] = $derived.by(() => {
    const set = new Set<string>();
    for (const n of store.notes) {
      for (const t of n.tags) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  const visibleNotes = $derived.by(() => {
    if (activeTag === null) return store.notes;
    return store.notes.filter((n) => n.tags.includes(activeTag as string));
  });

  function toggleTag(tag: string): void {
    activeTag = activeTag === tag ? null : tag;
  }

  onMount(() => {
    store.start();
    mentions.start();
  });
  onDestroy(() => {
    store.stop();
    mentions.stop();
  });

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

  {#if availableTags.length > 0}
    <div class="tagchips" data-testid="sidebar-tag-chips" role="group" aria-label="Filter by tag">
      {#each availableTags as tag (tag)}
        <button
          type="button"
          class="chip"
          class:on={activeTag === tag}
          data-testid={`sidebar-tag-chip-${tag}`}
          data-active={activeTag === tag}
          aria-pressed={activeTag === tag}
          onclick={() => toggleTag(tag)}
        >
          #{tag}
        </button>
      {/each}
    </div>
  {/if}

  <nav data-testid="notes-list" aria-label="Notes">
    {#if store.loading && store.notes.length === 0}
      <p class="hint">Loading…</p>
    {:else if store.error !== null && store.notes.length === 0}
      <p class="error" role="alert">Couldn't load notes: {store.error}</p>
    {:else if store.notes.length === 0}
      <p class="hint" data-testid="notes-list-empty">No notes yet.</p>
    {:else if visibleNotes.length === 0}
      <p class="hint" data-testid="notes-list-empty-filtered">
        No notes tagged <strong>#{activeTag}</strong>.
      </p>
    {:else}
      <ul>
        {#each visibleNotes as note (note.id)}
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

  <nav class="footer-nav" aria-label="App pages">
    <a class="footer-link" href="/inbox" data-testid="sidebar-inbox-link">
      Inbox
      {#if mentions.unread.length > 0}
        <span class="badge" data-testid="sidebar-inbox-badge">{mentions.unread.length}</span>
      {/if}
    </a>
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

  /* W-021 tag-filter chips. Wrap into multiple rows so a noisy
     vocabulary doesn't push the new-note button off-screen. */
  .tagchips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .chip {
    appearance: none;
    border: 1px solid #cfcfcf;
    background: #fff;
    color: #555;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-family: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .chip:hover {
    border-color: #5b8def;
    color: #333;
  }

  .chip.on {
    background: #5b8def;
    border-color: #5b8def;
    color: #fff;
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

  .footer-nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e0e0e0;
  }

  .footer-link {
    color: #555;
    text-decoration: none;
    font-size: 0.85rem;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .footer-link:hover {
    background: #ececec;
    color: #222;
  }

  .badge {
    background: #c0392b;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 0 0.4rem;
    line-height: 1.2;
    min-width: 1.2rem;
    text-align: center;
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
