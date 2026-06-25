<script lang="ts">
  // W-020 search overlay. Cmd-K (or Ctrl-K) opens it from anywhere
  // EXCEPT inside the editor — there Mod-K is the W-009 link popover
  // shortcut, which the ProseMirror keymap consumes first. We rely on
  // `event.defaultPrevented` to disambiguate: if the editor handled
  // the key, PM calls preventDefault and our window listener skips.
  //
  // The overlay is its own modal (not a sidebar panel) so the user
  // can find a note from anywhere without losing visual context — the
  // editor underneath stays visible behind the dimmer. Esc / click-
  // outside dismisses; Up/Down keys move selection; Enter opens.

  import { onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { parseSnippet, searchNotes, type SearchHit } from '$lib/api/search';

  let open = $state(false);
  let query = $state('');
  let inputEl: HTMLInputElement | null = $state(null);
  let hits: SearchHit[] = $state([]);
  let loading = $state(false);
  let error: string | null = $state(null);
  let selectedIndex = $state(0);
  let lastAbort: AbortController | null = null;
  let lastQueryRun = '';

  const DEBOUNCE_MS = 150;
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;

  export function openOverlay(): void {
    open = true;
    selectedIndex = 0;
    // Focus on the next macrotask so Svelte has finished rendering the
    // input element. `tick()` alone races a stray keyup/click from the
    // gesture that opened the overlay under heavy load — pushing focus
    // out a beat lets those settle before we grab it.
    void tick().then(() => {
      setTimeout(() => {
        inputEl?.focus();
        inputEl?.select();
      }, 0);
    });
  }

  function close(): void {
    open = false;
    query = '';
    hits = [];
    error = null;
    selectedIndex = 0;
    lastAbort?.abort();
    lastAbort = null;
  }

  async function runSearch(q: string): Promise<void> {
    if (q.trim().length === 0) {
      hits = [];
      loading = false;
      error = null;
      return;
    }
    lastAbort?.abort();
    const abort = new AbortController();
    lastAbort = abort;
    loading = true;
    lastQueryRun = q;
    try {
      const next = await searchNotes(q, { signal: abort.signal, limit: 25 });
      // Race guard: only commit if this is still the latest query.
      if (lastQueryRun === q) {
        hits = next;
        error = null;
        selectedIndex = 0;
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      error = e instanceof Error ? e.message : String(e);
      hits = [];
    } finally {
      if (lastQueryRun === q) loading = false;
    }
  }

  function scheduleSearch(): void {
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    const q = query;
    debounceHandle = setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
  }

  async function pick(hit: SearchHit): Promise<void> {
    close();
    await goto(`/n/${hit.id}`);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length > 0) selectedIndex = (selectedIndex + 1) % hits.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length > 0) selectedIndex = (selectedIndex - 1 + hits.length) % hits.length;
      return;
    }
    if (e.key === 'Enter') {
      const hit = hits[selectedIndex];
      if (hit !== undefined) {
        e.preventDefault();
        void pick(hit);
      }
    }
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    // Q-006: handle Escape at the window level when the overlay is
    // open. The panel + input each have an onkeydown handler, but
    // openOverlay() defers focusing the input until a setTimeout(0)
    // after tick() — so an Escape press that lands BEFORE focus has
    // moved to the input would otherwise be eaten by document.body and
    // leave the overlay stuck open. (Reproduces ~10% of the time on a
    // busy machine.) Listening at the window level for Escape closes
    // that race without changing the focus-deferral logic (which the
    // existing comment explains is itself a fix for a stray-event race
    // at open time).
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
      return;
    }
    const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    if (!isModK) return;
    // Editor's Mod-K (link popover, W-009) lives in ProseMirror's
    // keymap. PM doesn't auto-preventDefault on consumed keys, so we
    // can't rely on `defaultPrevented`; we check the event target
    // instead. Any target inside `.ProseMirror` (the live editor
    // surface) belongs to the editor's keymap.
    const target = e.target as Element | null;
    if (target !== null && target.closest('.ProseMirror') !== null) return;
    e.preventDefault();
    openOverlay();
  }

  onMount(() => {
    window.addEventListener('keydown', onWindowKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onWindowKeydown);
    }
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    lastAbort?.abort();
  });

  function onBackdropClick(e: MouseEvent): void {
    // Click on the dimmer (not on the modal panel) → close.
    if (e.target === e.currentTarget) close();
  }
</script>

{#if open}
  <div class="backdrop" data-testid="search-overlay" onclick={onBackdropClick} role="presentation">
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <input
        bind:this={inputEl}
        bind:value={query}
        oninput={scheduleSearch}
        onkeydown={onKeydown}
        type="text"
        class="input"
        data-testid="search-overlay-input"
        placeholder="Search notes…"
        autocomplete="off"
        spellcheck="false"
      />
      {#if loading}
        <p class="hint" data-testid="search-overlay-loading">Searching…</p>
      {:else if error !== null}
        <p class="errortext" data-testid="search-overlay-error">{error}</p>
      {:else if query.trim().length === 0}
        <p class="hint" data-testid="search-overlay-empty">
          Type to search note titles and bodies.
        </p>
      {:else if hits.length === 0}
        <p class="hint" data-testid="search-overlay-no-results">No results.</p>
      {:else}
        <ul class="results" data-testid="search-overlay-results" role="listbox">
          {#each hits as hit, i (hit.id)}
            <li
              class="row"
              class:active={i === selectedIndex}
              data-testid={`search-overlay-result-${hit.id}`}
              role="option"
              aria-selected={i === selectedIndex}
            >
              <button
                type="button"
                class="rowbtn"
                onmouseenter={() => {
                  selectedIndex = i;
                }}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => void pick(hit)}
              >
                <span class="title">{hit.title}</span>
                <span class="snippet" data-testid={`search-overlay-snippet-${hit.id}`}>
                  {#each parseSnippet(hit.snippet) as seg, j (j)}
                    {#if seg.highlighted}
                      <mark>{seg.text}</mark>
                    {:else}
                      {seg.text}
                    {/if}
                  {/each}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 6vh;
    z-index: 100;
  }

  .panel {
    width: min(40rem, 90vw);
    max-height: 70vh;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .input {
    appearance: none;
    border: none;
    border-bottom: 1px solid #e0e0e0;
    padding: 0.75rem 1rem;
    font-family: inherit;
    font-size: 1rem;
    outline: none;
  }

  .hint,
  .errortext {
    margin: 0;
    padding: 0.75rem 1rem;
    font-size: 0.85rem;
  }
  /* Q-005: WCAG AA — #888 on #fff is 3.54:1; #6f6f6f hits 4.55:1. */
  .hint {
    color: #6f6f6f;
    font-style: italic;
  }
  .errortext {
    color: #c0392b;
  }

  .results {
    list-style: none;
    padding: 0.25rem 0;
    margin: 0;
    overflow: auto;
  }

  .row {
    padding: 0;
  }

  .row.active {
    background: #eef3ff;
  }

  .rowbtn {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.5rem 1rem;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .title {
    font-size: 0.9rem;
    color: #222;
    font-weight: 500;
  }

  .snippet {
    font-size: 0.8rem;
    color: #666;
  }

  .snippet :global(mark) {
    background: #fff0a8;
    padding: 0 0.1em;
    border-radius: 2px;
  }
</style>
