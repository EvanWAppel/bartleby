<script lang="ts">
  // W-015: right pane tabs (Comments / Backlinks / History). The
  // Backlinks tab body is now live (W-016 -> BacklinksPane); Comments
  // and History stay placeholder pending W-017 / W-019.
  //
  // The active tab is persisted per note in localStorage so coming back
  // to a note feels sticky to whichever pane you were just reading. We
  // deliberately don't fall back to a global "last selected" — different
  // notes have different ergonomics (a research note might live in
  // Backlinks; a doc with active reviewers might live in Comments) and
  // a global default would constantly stomp those preferences.
  //
  // Default tab on first visit: Comments — it's the most active surface
  // in a collaborative editor and the one a returning user is most
  // likely to want at-a-glance. Easy to flip if telemetry says otherwise.

  import { onMount } from 'svelte';
  import BacklinksPane from './BacklinksPane.svelte';
  import CommentsPane from './CommentsPane.svelte';
  import SnapshotsPane from './SnapshotsPane.svelte';

  type RightPaneTab = 'comments' | 'backlinks' | 'history';

  // Tab metadata. Each tab mounts its own pane component; the
  // `placeholder` field is vestigial now that all three live tabs ship.
  const TABS: { id: RightPaneTab; label: string; placeholder: string }[] = [
    { id: 'comments', label: 'Comments', placeholder: '' },
    { id: 'backlinks', label: 'Backlinks', placeholder: '' },
    { id: 'history', label: 'History', placeholder: '' },
  ];

  const DEFAULT_TAB: RightPaneTab = 'comments';

  // The parent (AppShell) keys this component on noteId so it remounts on
  // every note navigation — onMount re-fires and we read the per-note
  // tab fresh from localStorage. This avoids a $effect racing the click
  // handler (the effect would re-read localStorage on every reactive
  // update and stomp the user's just-clicked choice).
  interface Props {
    noteId: string;
  }

  let { noteId }: Props = $props();

  function storageKey(id: string): string {
    return `bartleby:rightpane:tab:${id}`;
  }

  function isTab(v: unknown): v is RightPaneTab {
    return v === 'comments' || v === 'backlinks' || v === 'history';
  }

  // SSR safety: `localStorage` doesn't exist on the server. Initial render
  // uses DEFAULT_TAB; onMount upgrades to the persisted value.
  let activeTab: RightPaneTab = $state(DEFAULT_TAB);

  onMount(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(noteId));
      if (isTab(raw)) activeTab = raw;
    } catch {
      // localStorage can throw in some private-browsing modes; fall back
      // silently to the default so the UI still works.
    }
  });

  function select(tab: RightPaneTab): void {
    activeTab = tab;
    try {
      window.localStorage.setItem(storageKey(noteId), tab);
    } catch {
      // ditto — silent fall-through. The in-memory state already
      // updated so the user sees their click take effect; only the
      // persistence side is best-effort.
    }
  }
</script>

<div class="rightpane-inner" data-testid="note-right-pane">
  <div class="tablist" role="tablist" aria-label="Note details" data-testid="right-pane-tablist">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id={`right-pane-tab-${tab.id}`}
        aria-controls={`right-pane-panel-${tab.id}`}
        aria-selected={activeTab === tab.id}
        tabindex={activeTab === tab.id ? 0 : -1}
        class="tab"
        class:active={activeTab === tab.id}
        data-testid={`right-pane-tab-${tab.id}`}
        data-active={activeTab === tab.id}
        onclick={() => select(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#each TABS as tab (tab.id)}
    {#if activeTab === tab.id}
      <div
        role="tabpanel"
        id={`right-pane-panel-${tab.id}`}
        aria-labelledby={`right-pane-tab-${tab.id}`}
        class="panel"
        data-testid={`right-pane-panel-${tab.id}`}
      >
        {#if tab.id === 'backlinks'}
          <BacklinksPane {noteId} />
        {:else if tab.id === 'comments'}
          <CommentsPane {noteId} />
        {:else if tab.id === 'history'}
          <SnapshotsPane {noteId} />
        {:else}
          <p class="placeholder">{tab.placeholder}</p>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .rightpane-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 0.75rem;
  }

  .tablist {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #e0e0e0;
  }

  .tab {
    appearance: none;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.5rem 0.75rem;
    margin-bottom: -1px;
    color: #555;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .tab:hover {
    color: #222;
  }

  /* Q-005: WCAG AA — #5b8def on #fafafa is 3.09:1. Darken text to
     #3261b8 (≈ 5.4:1) while keeping the border accent at the brand
     blue (decorative, no contrast requirement at 3:1 for borders). */
  .tab.active {
    color: #3261b8;
    border-bottom-color: #5b8def;
    font-weight: 500;
  }

  .panel {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .placeholder {
    color: #888;
    font-size: 0.85rem;
    font-style: italic;
    margin: 0;
  }
</style>
