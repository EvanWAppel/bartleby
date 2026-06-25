<script lang="ts">
  // W-022 trash view. Lists soft-deleted notes (S-003); each row has
  // "Restore" (S-006, clears trashed_at) and "Delete forever"
  // (W-022 hard-delete endpoint, only allowed on already-trashed rows).
  //
  // Both destructive ops route through ConfirmDialog (W-024); restore
  // is reversible-enough that we skip the modal there. We optimistically
  // prune the local list after each action and refetch via invalidate
  // so the sidebar's NotesStore poll picks up the change too (the
  // restored note shows up in the sidebar within ~1s).

  import { invalidateAll } from '$app/navigation';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { hardDeleteNote, restoreNote, type NoteSummary } from '$lib/api/notes';

  interface Props {
    data: { notes: NoteSummary[] };
  }

  let { data }: Props = $props();

  // Optimistic prune: instead of mirroring data.notes into a separate
  // $state (which would race the eslint state-referenced-locally
  // rule), we track which ids the user has just removed and filter
  // them out of the derived list. invalidateAll() reruns load() which
  // re-pulls a clean list; clearing `hidden` then is a no-op since
  // the row is already gone server-side.
  let hidden = $state<Set<string>>(new Set());
  let notes = $derived<NoteSummary[]>(data.notes.filter((n) => !hidden.has(n.id)));

  // Pending "delete forever" target. null when no modal is up.
  let confirmDeleteTarget: NoteSummary | null = $state(null);
  let busyId: string | null = $state(null);

  async function onRestore(note: NoteSummary): Promise<void> {
    busyId = note.id;
    try {
      await restoreNote(note.id);
      hidden.add(note.id);
      hidden = new Set(hidden);
      await invalidateAll();
    } finally {
      busyId = null;
    }
  }

  async function onConfirmHardDelete(): Promise<void> {
    const target = confirmDeleteTarget;
    if (target === null) return;
    busyId = target.id;
    try {
      await hardDeleteNote(target.id);
      hidden.add(target.id);
      hidden = new Set(hidden);
      confirmDeleteTarget = null;
      await invalidateAll();
    } finally {
      busyId = null;
    }
  }

  function onCancelHardDelete(): void {
    confirmDeleteTarget = null;
  }
</script>

<svelte:head>
  <title>Trash · Bartleby</title>
</svelte:head>

<div class="trash" data-testid="trash-page">
  <header class="header">
    <h1>Trash</h1>
    <p class="hint">
      Notes here are auto-purged 30 days after they were moved to trash. Restore brings a note back;
      Delete forever removes it immediately.
    </p>
  </header>

  {#if notes.length === 0}
    <p class="empty" data-testid="trash-page-empty">Trash is empty.</p>
  {:else}
    <ul class="list" data-testid="trash-page-list">
      {#each notes as note (note.id)}
        <li class="row" data-testid={`trash-row-${note.id}`}>
          <div class="meta">
            <span class="title" data-testid={`trash-row-title-${note.id}`}>{note.title}</span>
            <span class="ts">trashed {note.updated_at}</span>
          </div>
          <div class="actions">
            <button
              type="button"
              class="btn"
              data-testid={`trash-row-restore-${note.id}`}
              disabled={busyId === note.id}
              onclick={() => void onRestore(note)}
            >
              Restore
            </button>
            <button
              type="button"
              class="btn danger"
              data-testid={`trash-row-delete-forever-${note.id}`}
              disabled={busyId === note.id}
              onclick={() => {
                confirmDeleteTarget = note;
              }}
            >
              Delete forever
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if confirmDeleteTarget !== null}
  <ConfirmDialog
    title="Delete forever?"
    body={`"${confirmDeleteTarget.title}" will be permanently removed, along with its comments, snapshots, and backlinks. This cannot be undone.`}
    confirmLabel="Delete forever"
    confirmTone="danger"
    onConfirm={() => void onConfirmHardDelete()}
    onCancel={onCancelHardDelete}
  />
{/if}

<style>
  .trash {
    max-width: 48rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
  }

  .hint {
    margin: 0;
    color: #666;
    font-size: 0.85rem;
  }

  /* Q-005: WCAG AA — #888 on #fff is 3.54:1; #6f6f6f hits 4.55:1. */
  .empty {
    color: #6f6f6f;
    font-style: italic;
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    background: #fff;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .title {
    font-size: 0.95rem;
    color: #222;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Q-005: WCAG AA — #888 on #fff is 3.54:1. #6f6f6f hits 4.55:1. */
  .ts {
    font-size: 0.7rem;
    color: #6f6f6f;
  }

  .actions {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .btn {
    appearance: none;
    border: 1px solid #cfcfcf;
    background: #fff;
    color: #444;
    padding: 0.3rem 0.65rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .btn:hover {
    background: #f5f5f5;
  }

  .btn.danger {
    color: #c0392b;
    border-color: #e0a0a0;
  }

  .btn.danger:hover {
    background: #fdecea;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
