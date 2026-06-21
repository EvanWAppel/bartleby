<script lang="ts">
  // W-012 backlink autocomplete picker. Mounted by Editor.svelte while
  // the cursor sits inside an active `[[…` trigger; the parent feeds
  // the current query (the text after `[[`) reactively, and we filter
  // the in-memory NotesStore locally — case-insensitive substring
  // match on title — so typing is instant and works offline.
  //
  // Apply forwards (targetId, title) to the parent, which replaces
  // `[[query` in the doc with a backlink node. Escape just calls
  // onCancel; per the W-012 cancel-mode decision, the parent leaves
  // the literal `[[query` text in the doc so the S-009 backlink
  // extractor still resolves it server-side.
  //
  // We deliberately don't manage the search input ourselves — the
  // query lives in the editor and we receive it as a prop, so there's
  // only one source of truth for what the user typed.

  import type { NoteSummary } from '$lib/api/notes';

  interface Props {
    /** Live text typed after `[[`. */
    query: string;
    /** Candidate notes (typically NotesStore.notes). */
    notes: NoteSummary[];
    /** Current note's id — excluded so you can't backlink to yourself. */
    excludeNoteId: string;
    onApply: (targetId: string, title: string) => void;
    onCancel: () => void;
  }

  // The popover stays non-focused so the editor keeps capturing
  // keystrokes (Notion/Obsidian convention). onCancel is accepted as
  // a prop for symmetry with LinkPopover / CodeLangPopover — Escape
  // is intercepted upstream by the trigger plugin's keymap, not here,
  // so we never call onCancel from inside this component.
  let { query, notes, excludeNoteId, onApply }: Props = $props();

  // Filter + cap. We sort by lowercase title for a stable order and
  // cap at 8 so a fresh note with many candidates doesn't push the
  // popover off-screen.
  const MAX_RESULTS = 8;
  let matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const filtered = notes.filter((n) => {
      if (n.id === excludeNoteId) return false;
      if (q.length === 0) return true;
      return n.title.toLowerCase().includes(q);
    });
    filtered.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    return filtered.slice(0, MAX_RESULTS);
  });

  function holdFocus(e: MouseEvent): void {
    // Same idiom as LinkPopover / CodeLangPopover: clicking a candidate
    // must NOT blur the editor (the parent needs the live view's
    // selection intact when it dispatches the replace transaction).
    e.preventDefault();
  }
</script>

<div class="popover" data-testid="backlink-picker" role="listbox" aria-label="Backlink target">
  {#if matches.length === 0}
    <div class="empty" data-testid="backlink-picker-empty">No notes match</div>
  {:else}
    {#each matches as note (note.id)}
      <button
        type="button"
        class="row"
        role="option"
        aria-selected="false"
        data-testid={`backlink-option-${note.id}`}
        onmousedown={holdFocus}
        onclick={() => onApply(note.id, note.title)}
      >
        {note.title}
      </button>
    {/each}
  {/if}
</div>

<style>
  .popover {
    display: flex;
    flex-direction: column;
    min-width: 16rem;
    max-width: 24rem;
    padding: 0.25rem;
    border: 1px solid #ccc;
    border-bottom: none;
    background: #fff;
    outline: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .empty {
    padding: 0.5rem 0.75rem;
    color: #888;
    font-size: 0.85rem;
    font-style: italic;
  }

  .row {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    padding: 0.35rem 0.5rem;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 4px;
  }

  .row:hover,
  .row:focus {
    background: #eef3ff;
    outline: none;
  }
</style>
