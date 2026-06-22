<script lang="ts">
  // W-019 history pane. Fetches the per-note snapshot list and renders
  // it newest-first. Selecting a row pulls the detail (yjs_state +
  // pre-rendered markdown_preview) and shows it in a preview area.
  // "Restore" calls C-006 — server takes a pre-restore auto-snapshot
  // of the current live doc, then applies the selected snapshot's
  // bytes. The next time the editor reconnects (or the local Yjs
  // provider receives the update), the visible doc switches.
  //
  // We DON'T poll. New snapshots come from two places:
  //   - C-002 scheduler (every ~5 min in production; the user can
  //     reload to see new auto rows).
  //   - the "Save snapshot" form in this pane (we refetch after each
  //     successful POST).
  // For "list updates live across sessions" the W-024 awareness work
  // is the right layer; for v1 a manual reload covers the gap.

  import { onMount } from 'svelte';
  import {
    createNamedSnapshot,
    getSnapshot,
    listSnapshots,
    restoreSnapshot,
    type SnapshotSummary,
    type SnapshotDetail,
  } from '$lib/api/snapshots';

  interface Props {
    noteId: string;
  }

  let { noteId }: Props = $props();

  let loading = $state(true);
  let error: string | null = $state(null);
  let snapshots: SnapshotSummary[] = $state([]);

  // Compose state for "save a named snapshot".
  let composerOpen = $state(false);
  let composerLabel = $state('');
  let saving = $state(false);

  // Preview state. We lazily fetch the detail (bytes + markdown) only
  // when the user selects a row — the list endpoint deliberately
  // omits both to keep responses bounded.
  let selectedId: string | null = $state(null);
  let selectedDetail: SnapshotDetail | null = $state(null);
  let previewLoading = $state(false);
  let restoring = $state(false);

  async function refresh(): Promise<void> {
    loading = true;
    try {
      snapshots = await listSnapshots(noteId);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
  });

  async function onSelect(id: string): Promise<void> {
    if (selectedId === id) return;
    selectedId = id;
    selectedDetail = null;
    previewLoading = true;
    try {
      selectedDetail = await getSnapshot(noteId, id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      previewLoading = false;
    }
  }

  async function onSaveNamed(): Promise<void> {
    const label = composerLabel.trim();
    if (label.length === 0) return;
    saving = true;
    try {
      const created = await createNamedSnapshot(noteId, label);
      snapshots = [created, ...snapshots];
      composerLabel = '';
      composerOpen = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function onRestore(): Promise<void> {
    if (selectedId === null) return;
    if (!confirm('Restore this snapshot? The current state will be saved as an auto-snapshot.')) {
      return;
    }
    restoring = true;
    try {
      await restoreSnapshot(noteId, selectedId);
      // Refresh the list (a new pre-restore auto-snapshot now sits at
      // the top) and clear the preview. The live editor will pick up
      // the new doc state via Yjs awareness when the WS round-trips.
      await refresh();
      selectedId = null;
      selectedDetail = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      restoring = false;
    }
  }

  function labelFor(s: SnapshotSummary): string {
    if (s.label !== null && s.label.length > 0) return s.label;
    return 'auto';
  }

  function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }
</script>

<div class="snapshots" data-testid="snapshots-pane">
  <div class="header">
    {#if !composerOpen}
      <button
        type="button"
        class="btn"
        data-testid="snapshots-pane-save-open"
        onclick={() => {
          composerOpen = true;
        }}
      >
        Save snapshot
      </button>
    {:else}
      <form
        class="composer"
        data-testid="snapshots-pane-save-form"
        onsubmit={(e) => {
          e.preventDefault();
          void onSaveNamed();
        }}
      >
        <input
          type="text"
          class="input"
          placeholder="Label (e.g. v1.0)"
          bind:value={composerLabel}
          data-testid="snapshots-pane-save-label"
        />
        <button
          type="submit"
          class="btn primary"
          disabled={saving || composerLabel.trim().length === 0}
          data-testid="snapshots-pane-save-submit"
        >
          Save
        </button>
        <button
          type="button"
          class="btn"
          onclick={() => {
            composerOpen = false;
            composerLabel = '';
          }}
        >
          Cancel
        </button>
      </form>
    {/if}
  </div>

  {#if loading}
    <p class="hint" data-testid="snapshots-pane-loading">Loading snapshots…</p>
  {:else if error !== null}
    <p class="errortext" data-testid="snapshots-pane-error">
      Couldn't load snapshots: {error}
    </p>
  {:else if snapshots.length === 0}
    <p class="hint" data-testid="snapshots-pane-empty">No snapshots yet.</p>
  {:else}
    <ul class="list" data-testid="snapshots-pane-list">
      {#each snapshots as snap (snap.id)}
        <li
          class="row"
          class:selected={selectedId === snap.id}
          data-testid={`snapshots-row-${snap.id}`}
        >
          <button
            type="button"
            class="rowbtn"
            data-testid={`snapshots-select-${snap.id}`}
            onclick={() => void onSelect(snap.id)}
          >
            <span class="label" class:auto={snap.label === null}>{labelFor(snap)}</span>
            <span class="ts">{formatTimestamp(snap.created_at)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if selectedId !== null}
    <div class="preview" data-testid="snapshots-pane-preview">
      {#if previewLoading}
        <p class="hint" data-testid="snapshots-pane-preview-loading">Loading preview…</p>
      {:else if selectedDetail !== null}
        <pre
          class="markdown"
          data-testid="snapshots-pane-preview-markdown">{selectedDetail.markdown_preview}</pre>
        <button
          type="button"
          class="btn primary"
          data-testid="snapshots-pane-restore"
          disabled={restoring}
          onclick={() => void onRestore()}
        >
          Restore this snapshot
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .snapshots {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100%;
    overflow: auto;
  }

  .header {
    display: flex;
    gap: 0.35rem;
  }

  .composer {
    display: flex;
    gap: 0.35rem;
    flex: 1;
    flex-wrap: wrap;
  }

  .input {
    flex: 1;
    appearance: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    font-family: inherit;
    font-size: 0.85rem;
  }

  .input:focus {
    outline: 2px solid #5b8def;
    outline-offset: -1px;
  }

  .btn {
    appearance: none;
    border: 1px solid #ccc;
    background: #fff;
    color: #444;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
    font-family: inherit;
  }

  .btn.primary {
    background: #5b8def;
    color: #fff;
    border-color: #5b8def;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
    font-style: italic;
    margin: 0;
  }

  .errortext {
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
    gap: 0.2rem;
  }

  .row {
    border: 1px solid transparent;
    border-radius: 4px;
  }

  .row.selected {
    border-color: #5b8def;
    background: #eef3ff;
  }

  .rowbtn {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.5rem;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .rowbtn:hover {
    background: rgba(91, 141, 239, 0.08);
    border-radius: 4px;
  }

  .label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #333;
  }

  .label.auto {
    font-weight: 400;
    color: #888;
    font-style: italic;
  }

  .ts {
    font-size: 0.7rem;
    color: #888;
  }

  .preview {
    border-top: 1px solid #e0e0e0;
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .markdown {
    margin: 0;
    padding: 0.5rem;
    background: #fafafa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    color: #444;
    max-height: 12rem;
    overflow: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>
