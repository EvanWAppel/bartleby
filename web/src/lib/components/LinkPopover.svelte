<script lang="ts">
  // W-009 link popover. Inline panel below the toolbar shown when
  // the user invokes "add link" via Mod-K or the toolbar Link button
  // on a non-empty selection. The parent (Editor.svelte) captures the
  // selection range BEFORE this component mounts; submit applies the
  // link mark to that captured range — focus drifting to the URL
  // input would otherwise drop ProseMirror's selection.
  //
  // Empty URL on submit is treated as cancel — that's how "remove link"
  // could be hooked up later without changing the apply/cancel shape.

  interface Props {
    onApply: (href: string) => void;
    onCancel: () => void;
  }

  let { onApply, onCancel }: Props = $props();

  let url: string = $state('');
  let inputEl: HTMLInputElement | undefined = $state(undefined);

  $effect(() => {
    // Auto-focus on first render so the user can type immediately.
    // The effect re-runs if inputEl changes; it's set exactly once
    // (bind:this fires on mount), so this fires exactly once.
    inputEl?.focus();
  });

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      onCancel();
      return;
    }
    onApply(trimmed);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<form class="popover" data-testid="link-popover" onsubmit={onSubmit}>
  <input
    type="url"
    bind:value={url}
    bind:this={inputEl}
    class="url"
    placeholder="https://…"
    data-testid="link-popover-input"
    aria-label="Link URL"
    onkeydown={onKeydown}
  />
  <button type="submit" class="apply" data-testid="link-popover-apply">Apply</button>
  <button type="button" class="cancel" data-testid="link-popover-cancel" onclick={onCancel}>
    Cancel
  </button>
</form>

<style>
  .popover {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ccc;
    border-bottom: none;
    background: #fff;
  }

  .url {
    flex: 1;
    appearance: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-family: inherit;
    font-size: 0.9rem;
  }

  .url:focus {
    border-color: #5b8def;
    outline: none;
  }

  .popover button {
    appearance: none;
    border: 1px solid #ddd;
    background: #f7f7f8;
    color: inherit;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }

  .popover .apply {
    border-color: #5b8def;
    background: #5b8def;
    color: #fff;
  }
</style>
