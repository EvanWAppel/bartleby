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
  // W-029 blur-to-save: a native `blur` listener attached with
  // addEventListener in an $effect (not a Svelte handler prop) calls
  // form.requestSubmit() when the input's value differs from the
  // server title, so blur reuses the exact form-submit path Enter
  // takes. It reads the DOM value, not `draft`, to avoid racing
  // Svelte's bind:value flush. `data-blur-ready` flips to "true" once
  // the listener is attached so Playwright can gate on hydration.

  interface Props {
    id: string;
    title: string;
  }
  let { id, title }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft: string = $state(title);
  // svelte-ignore state_referenced_locally
  let serverTitle: string = $state(title);

  let inputEl: HTMLInputElement | null = $state(null);
  let blurReady: boolean = $state(false);
  // Guard against a double submit when Enter's native submit navigates
  // away and the resulting blur fires during unload.
  let submitting = false;

  $effect(() => {
    const el = inputEl;
    if (el === null) return;
    const form = el.form;
    const onSubmit = (): void => {
      submitting = true;
    };
    const onBlur = (): void => {
      if (submitting || form === null) return;
      if (el.value.trim() === serverTitle.trim()) return;
      form.requestSubmit();
    };
    form?.addEventListener('submit', onSubmit);
    el.addEventListener('blur', onBlur);
    blurReady = true;
    return () => {
      form?.removeEventListener('submit', onSubmit);
      el.removeEventListener('blur', onBlur);
      blurReady = false;
    };
  });

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
    data-blur-ready={blurReady ? 'true' : undefined}
    bind:this={inputEl}
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
