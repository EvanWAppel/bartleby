<script lang="ts">
  // W-018 inline comment composer. Mounted by Editor.svelte while the
  // user has a non-empty text selection AND has clicked the floating
  // "Comment" toolbar's button to start composing. The selected text
  // is shown as a muted quote so the user can see what they're
  // commenting on; submitting fires onSubmit(body) and the parent
  // handles the anchor serialization + POST.
  //
  // Focus management: the textarea grabs focus on mount (the user
  // explicitly clicked Comment, so they want to type). We capture
  // Escape to cancel and Cmd/Ctrl+Enter to submit — bare Enter inserts
  // a newline as you'd expect from a multi-line textarea.

  import { onMount, tick } from 'svelte';

  interface Props {
    /** Selected text snapshot for the visible quote. */
    quote: string;
    /** Called when the user submits (non-empty body). */
    onSubmit: (body: string) => void;
    /** Called when the user dismisses without submitting. */
    onCancel: () => void;
  }

  let { quote, onSubmit, onCancel }: Props = $props();

  let textarea: HTMLTextAreaElement | null = $state(null);
  let body = $state('');
  let submitting = $state(false);

  onMount(async () => {
    await tick();
    textarea?.focus();
  });

  function submit(): void {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    submitting = true;
    onSubmit(trimmed);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="popover" data-testid="comment-composer">
  {#if quote.length > 0}
    <p class="quote" data-testid="comment-composer-quote">{quote}</p>
  {/if}
  <textarea
    bind:this={textarea}
    bind:value={body}
    class="textarea"
    data-testid="comment-composer-body"
    placeholder="Comment on the selected text…"
    rows="3"
    onkeydown={onKeydown}
  ></textarea>
  <div class="actions">
    <button
      type="button"
      class="btn"
      onclick={onCancel}
      data-testid="comment-composer-cancel"
      disabled={submitting}
    >
      Cancel
    </button>
    <button
      type="button"
      class="btn primary"
      onclick={submit}
      data-testid="comment-composer-submit"
      disabled={submitting || body.trim().length === 0}
    >
      Comment
    </button>
  </div>
</div>

<style>
  .popover {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 18rem;
    max-width: 22rem;
    padding: 0.5rem;
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .quote {
    margin: 0;
    padding: 0.25rem 0.5rem;
    border-left: 2px solid #5b8def;
    background: #eef3ff;
    color: #444;
    font-size: 0.8rem;
    font-style: italic;
    max-height: 4em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .textarea {
    appearance: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    font-family: inherit;
    font-size: 0.85rem;
    resize: vertical;
    box-sizing: border-box;
  }

  .textarea:focus {
    outline: 2px solid #5b8def;
    outline-offset: -1px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
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
</style>
