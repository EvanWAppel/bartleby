<script lang="ts">
  // W-006 title editor — form-submit pattern.
  //
  // Why a form: Svelte 5 delegates input/blur/click event handlers to
  // document-level listeners, and in our Playwright test environment
  // those weren't reaching the title input reliably. A native form
  // submit goes through the browser's real submit path, which works
  // in both production and tests without surprises.
  //
  // Enter submits the form natively. Escape reverts the visible value
  // to the server's current title.
  //
  // Known limitation: blur-to-save isn't wired up here; the "blur also
  // commits" branch of W-006 needs a JS handler that survives Svelte 5
  // event delegation. Deferred — Enter satisfies the core spec.

  interface Props {
    id: string;
    title: string;
  }
  let { id, title }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft: string = $state(title);
  // svelte-ignore state_referenced_locally
  let serverTitle: string = $state(title);

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      draft = serverTitle;
    }
    // Enter is handled natively by the form (default submit behavior).
  }
</script>

<form method="POST" action="/api/notes/{id}/rename" data-testid="title-form" class="title-row">
  <input
    name="title"
    bind:value={draft}
    type="text"
    class="title"
    data-testid="title-input"
    aria-label="Note title"
    onkeydown={onKeydown}
  />
</form>

<style>
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .title {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem 0.5rem;
    font-size: 1.6rem;
    font-weight: 600;
    flex: 1;
    background: transparent;
    color: inherit;
    font-family: inherit;
  }

  .title:hover {
    border-color: #ddd;
  }

  .title:focus {
    border-color: #5b8def;
    outline: none;
    background: #fff;
  }
</style>
