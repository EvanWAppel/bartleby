<script lang="ts">
  // W-013 mention picker. Mounted by Editor.svelte while the cursor sits
  // inside an active `@…` trigger; the parent feeds the current query
  // (text after `@`) reactively, and we filter the in-memory UsersStore
  // locally — case-insensitive substring match on displayName + email —
  // so typing is instant and works offline of the /users endpoint.
  //
  // Apply forwards (email, displayName) to the parent, which replaces
  // `@query` in the doc with a mention node. Escape just calls
  // onCancel; the literal `@query` text is left untouched server-side
  // (no extractor cares about loose `@`s in v1).
  //
  // We deliberately don't manage the search input ourselves — the
  // query lives in the editor and we receive it as a prop, so there's
  // only one source of truth for what the user typed. Same idiom as
  // BacklinkPickerPopover.

  import type { UserSummary } from '$lib/api/users';

  interface Props {
    /** Live text typed after `@`. */
    query: string;
    /** Candidate users (typically UsersStore.users). */
    users: UserSummary[];
    onApply: (email: string, displayName: string) => void;
    onCancel: () => void;
  }

  let { query, users, onApply }: Props = $props();

  // Filter + cap. We sort by lowercase displayName||email for a stable
  // order and cap at 8 so the popover stays predictable. Empty query
  // means "show everyone" (Slack/Notion convention).
  const MAX_RESULTS = 8;
  let matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (q.length === 0) return true;
      const haystack = (u.displayName ?? '').toLowerCase() + ' ' + u.email.toLowerCase();
      return haystack.includes(q);
    });
    filtered.sort((a, b) => {
      const al = (a.displayName ?? a.email).toLowerCase();
      const bl = (b.displayName ?? b.email).toLowerCase();
      return al.localeCompare(bl);
    });
    return filtered.slice(0, MAX_RESULTS);
  });

  function holdFocus(e: MouseEvent): void {
    // Clicking a candidate must NOT blur the editor — the parent needs
    // the live view's selection intact when it dispatches the replace
    // transaction.
    e.preventDefault();
  }

  function labelFor(u: UserSummary): string {
    if (u.displayName !== null && u.displayName.length > 0) return u.displayName;
    return u.email;
  }
</script>

<div class="popover" data-testid="mention-picker" role="listbox" aria-label="Mention target">
  {#if matches.length === 0}
    <div class="empty" data-testid="mention-picker-empty">No users match</div>
  {:else}
    {#each matches as user (user.email)}
      <button
        type="button"
        class="row"
        role="option"
        aria-selected="false"
        data-testid={`mention-option-${user.email}`}
        onmousedown={holdFocus}
        onclick={() => onApply(user.email, user.displayName ?? '')}
      >
        <span class="label">{labelFor(user)}</span>
        {#if user.displayName !== null && user.displayName.length > 0}
          <span class="email">{user.email}</span>
        {/if}
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
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .row:hover,
  .row:focus {
    background: #eef3ff;
    outline: none;
  }

  .label {
    color: inherit;
  }

  .email {
    font-size: 0.75rem;
    color: #888;
  }
</style>
