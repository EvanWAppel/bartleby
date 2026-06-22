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

  interface Props {
    user: { display_name: string; color: string } | null;
  }
  let { user }: Props = $props();

  const store = new NotesStore();

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

  let sidebarEl: HTMLElement | null = $state(null);
  let dragHandlersAttached = false;

  function attachDragHandlers(el: HTMLElement): void {
    if (dragHandlersAttached) return;
    dragHandlersAttached = true;
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', (e) => void onDrop(e as DragEvent));
  }

  onMount(() => {
    store.start();
    if (sidebarEl !== null) attachDragHandlers(sidebarEl);
  });
  onDestroy(() => store.stop());

  function isActive(id: string): boolean {
    return page.url.pathname === `/n/${id}`;
  }

  // W-025 drag-and-drop import. Listen for files dropped anywhere on
  // the sidebar; POST each `.md` file to /notes/import as multipart;
  // refresh the NotesStore so the new rows show up immediately
  // instead of waiting for the next 1s poll.
  let isDropTarget = $state(false);
  let importing = $state(false);
  let importError: string | null = $state(null);

  function onDragOver(e: DragEvent): void {
    if (e.dataTransfer === null) return;
    // Only react if the drag is carrying files (text drags don't
    // trigger the import flow).
    const types = e.dataTransfer.types;
    if (!types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    isDropTarget = true;
  }

  function onDragLeave(e: DragEvent): void {
    // dragleave fires when crossing child element boundaries too. The
    // relatedTarget check filters those out — only clear the flag when
    // the cursor actually exits the sidebar.
    if (e.currentTarget instanceof HTMLElement && e.relatedTarget instanceof Node) {
      if (e.currentTarget.contains(e.relatedTarget)) return;
    }
    isDropTarget = false;
  }

  async function onDrop(e: DragEvent): Promise<void> {
    if (e.dataTransfer === null) return;
    e.preventDefault();
    isDropTarget = false;
    const files: File[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      // Accept anything that looks like markdown; mime types coming
      // off the OS are inconsistent (`text/markdown`, `text/x-markdown`,
      // or just `text/plain`), so we key off the extension first.
      if (/\.(md|markdown)$/i.test(f.name) || f.type.toLowerCase().includes('markdown')) {
        files.push(f);
      }
    }
    if (files.length === 0) return;
    importing = true;
    importError = null;
    try {
      const form = new FormData();
      for (const f of files) form.append('files', f, f.name);
      const res = await fetch('/notes/import', { method: 'POST', body: form });
      if (!res.ok) {
        importError = `import failed: ${res.status}`;
        return;
      }
      // Force-refresh the notes list so the new rows surface before
      // the next 1s poll cycle.
      await store.refresh();
    } catch (err) {
      importError = err instanceof Error ? err.message : String(err);
    } finally {
      importing = false;
    }
  }
</script>

<aside
  bind:this={sidebarEl}
  class="sidebar"
  class:dropping={isDropTarget}
  data-testid="sidebar"
  data-import-active={isDropTarget}
  aria-label="Notes navigation"
>
  <header class="brand">
    <h1>Bartleby</h1>
  </header>

  <form method="POST" action="/api/notes/new" data-testid="new-note-form">
    <button class="new" type="submit" data-testid="new-note-button"> + New note </button>
  </form>

  {#if importing}
    <p class="hint" data-testid="sidebar-import-progress">Importing…</p>
  {/if}
  {#if importError !== null}
    <p class="error" data-testid="sidebar-import-error" role="alert">{importError}</p>
  {/if}

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

  /* W-025 drop target: hint that dropping markdown here will import. */
  .sidebar.dropping {
    background: #eef3ff;
    box-shadow: inset 0 0 0 2px #5b8def;
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
