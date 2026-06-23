<script lang="ts">
  // W-024 confirmation modal. Generic enough to host both the
  // soft-delete prompt ("Move to trash?") from the note view + sidebar
  // and the hard-delete prompt ("Delete forever? This cannot be
  // undone.") on the /trash page. Callers pass title/body/confirmLabel
  // and an `onConfirm` handler; we own focus, Esc, and backdrop click.
  //
  // Esc / backdrop click / Cancel = onCancel.
  // Enter while focused = onConfirm. Confirm button gets focus on
  // mount so a hot-key user can fire-and-forget.

  import { onMount, tick } from 'svelte';

  interface Props {
    title: string;
    body: string;
    confirmLabel: string;
    /** Pass 'danger' for destructive ops; tints the confirm button red. */
    confirmTone?: 'primary' | 'danger';
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { title, body, confirmLabel, confirmTone = 'primary', onConfirm, onCancel }: Props = $props();

  let confirmButton: HTMLButtonElement | null = $state(null);
  let submitting = $state(false);

  onMount(async () => {
    await tick();
    confirmButton?.focus();
  });

  function handleConfirm(): void {
    if (submitting) return;
    submitting = true;
    onConfirm();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      // Only fire on Enter when the confirm button itself has focus —
      // otherwise the user might be tabbing through other elements.
      if (document.activeElement === confirmButton) {
        e.preventDefault();
        handleConfirm();
      }
    }
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onCancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Esc is handled at the window level (above); a backdrop-scoped
     keydown listener would add nothing for keyboard users. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" data-testid="confirm-dialog" onclick={onBackdropClick} role="presentation">
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-dialog-title"
    aria-describedby="confirm-dialog-body"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
  >
    <h2 class="title" id="confirm-dialog-title" data-testid="confirm-dialog-title">{title}</h2>
    <p class="body" id="confirm-dialog-body" data-testid="confirm-dialog-body">{body}</p>
    <div class="actions">
      <button
        type="button"
        class="btn"
        onclick={onCancel}
        data-testid="confirm-dialog-cancel"
        disabled={submitting}
      >
        Cancel
      </button>
      <button
        bind:this={confirmButton}
        type="button"
        class="btn"
        class:primary={confirmTone === 'primary'}
        class:danger={confirmTone === 'danger'}
        onclick={handleConfirm}
        data-testid="confirm-dialog-confirm"
        disabled={submitting}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 200;
  }

  .panel {
    background: #fff;
    border-radius: 8px;
    padding: 1rem;
    width: min(28rem, 90vw);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .title {
    margin: 0;
    font-size: 1rem;
    color: #222;
  }

  .body {
    margin: 0;
    color: #555;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
    margin-top: 0.25rem;
  }

  .btn {
    appearance: none;
    border: 1px solid #ccc;
    background: #fff;
    color: #444;
    padding: 0.35rem 0.75rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn.primary {
    background: #5b8def;
    border-color: #5b8def;
    color: #fff;
  }

  .btn.danger {
    background: #c0392b;
    border-color: #c0392b;
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
