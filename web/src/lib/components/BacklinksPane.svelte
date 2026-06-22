<script lang="ts">
  // W-016 backlinks pane. Fetches inbound links for the current note
  // from /notes/:id/backlinks and renders one row per source note as a
  // clickable link to the source.
  //
  // We refresh on noteId change (the parent NoteRightPane keys us via
  // {#key noteId} so this component remounts cleanly when navigating
  // /n/a → /n/b — same pattern as W-015's per-note state). Inbound
  // links don't change at high frequency; a slow background refresh is
  // overkill for v1 and we deliberately don't poll. The list updates
  // naturally on note navigation, and the underlying S-009 hook
  // populates the backlinks table after a 1–2s debounce — close enough.
  //
  // Errors render an inline message but don't blow up the rest of the
  // right pane (the user can keep working on other panels).

  import { onMount } from 'svelte';
  import { listBacklinks, type InboundBacklink } from '$lib/api/notes';

  interface Props {
    noteId: string;
  }

  let { noteId }: Props = $props();

  let loading = $state(true);
  let error: string | null = $state(null);
  let backlinks: InboundBacklink[] = $state([]);

  onMount(async () => {
    try {
      backlinks = await listBacklinks(noteId);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="backlinks" data-testid="backlinks-pane">
  {#if loading}
    <p class="hint" data-testid="backlinks-pane-loading">Loading backlinks…</p>
  {:else if error !== null}
    <p class="error" data-testid="backlinks-pane-error">Couldn't load backlinks: {error}</p>
  {:else if backlinks.length === 0}
    <p class="hint" data-testid="backlinks-pane-empty">No notes link to this one yet.</p>
  {:else}
    <ul class="list" data-testid="backlinks-pane-list">
      {#each backlinks as link (link.sourceId)}
        <li class="row">
          <a
            class="title"
            href={`/n/${link.sourceId}`}
            data-testid={`backlink-source-${link.sourceId}`}
          >
            {link.sourceTitle}
          </a>
          {#if link.linkText !== '' && link.linkText !== link.sourceTitle}
            <span class="linktext" title="Link text in source">[[{link.linkText}]]</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .backlinks {
    height: 100%;
    overflow: auto;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
    font-style: italic;
    margin: 0;
  }

  .error {
    color: #c0392b;
    font-size: 0.85rem;
    margin: 0;
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .title {
    color: #5b8def;
    text-decoration: none;
    font-size: 0.9rem;
  }

  .title:hover {
    text-decoration: underline;
  }

  .linktext {
    color: #888;
    font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
