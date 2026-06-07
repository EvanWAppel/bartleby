<script lang="ts">
  // W-007 tag chip editor — pure-form pattern, no JS submit handlers.
  //
  // Two flavors of form on this component, both posting to the same
  // /api/notes/[id]/retag endpoint:
  //
  //   1. Chip × (remove): hidden `tags` field = "all current tags
  //      EXCEPT this one", set at render time. Click × → native form
  //      submit → endpoint PATCHes that list as the full new state.
  //
  //   2. Add: hidden `tags` field = "all current tags" + a visible
  //      `newtag` text input. Both values are read by the endpoint
  //      from the form body at submit time; the endpoint appends the
  //      trimmed `newtag` (if non-empty) and dedupes.
  //
  // Why no $derived-driven hidden field for the add form: Svelte 5
  // delegates input/blur/click/submit handlers and flushes reactive
  // DOM-attribute updates via microtask. In the Playwright runtime,
  // a `bind:value={draft}` → `$derived` → hidden-input-`value`-attr
  // chain didn't land before the browser collected form data on
  // Enter, so the endpoint received the stale hidden value. Reading
  // the visible input's own `name="newtag"` value sidesteps Svelte
  // entirely — the browser delivers whatever the user typed.
  //
  // Newline (not comma) is the `tags` delimiter so tags containing
  // `,` round-trip safely; S-004 imposes no character restrictions.

  interface Props {
    id: string;
    tags: string[];
  }
  let { id, tags }: Props = $props();

  function tagsWithout(removed: string): string {
    return tags.filter((t) => t !== removed).join('\n');
  }
</script>

<div class="tag-row" data-testid="tag-editor">
  {#each tags as tag (tag)}
    <form method="POST" action="/api/notes/{id}/retag" class="chip-form">
      <input type="hidden" name="tags" value={tagsWithout(tag)} />
      <span class="chip" data-testid="tag-chip">
        <span class="chip-label">{tag}</span>
        <button
          type="submit"
          class="chip-remove"
          data-testid="tag-remove"
          aria-label="Remove tag {tag}">×</button
        >
      </span>
    </form>
  {/each}

  <form method="POST" action="/api/notes/{id}/retag" class="add-form">
    <input type="hidden" name="tags" value={tags.join('\n')} />
    <input
      type="text"
      name="newtag"
      class="add-input"
      data-testid="tag-add-input"
      aria-label="Add tag"
      placeholder="Add tag"
    />
  </form>
</div>

<style>
  .tag-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }

  .chip-form {
    display: inline-flex;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    background: #eef2ff;
    color: #3030a0;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .chip-remove {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 1rem;
    line-height: 1;
    opacity: 0.7;
  }

  .chip-remove:hover {
    opacity: 1;
  }

  .add-form {
    display: inline-flex;
  }

  .add-input {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font-size: 0.9rem;
    background: transparent;
    color: inherit;
    font-family: inherit;
    min-width: 8rem;
  }

  .add-input:hover {
    border-color: #ddd;
  }

  .add-input:focus {
    border-color: #5b8def;
    outline: none;
    background: #fff;
  }
</style>
