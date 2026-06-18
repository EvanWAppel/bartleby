<script lang="ts">
  // W-011 code-block language picker. Inline panel anchored below the
  // toolbar (shared layout with LinkPopover) — Editor.svelte owns the
  // open/closed flag and the captured code_block position; the
  // NodeView triggers `open` and forwards the user's pick back via
  // `onApply(lang)`. Empty selection / outside-click / Escape =
  // onCancel without changing the language.
  //
  // We list the languages straight from SUPPORTED_CODE_LANGUAGES so the
  // grid expands automatically as the list grows.

  import { SUPPORTED_CODE_LANGUAGES } from '$lib/editor/code-languages';

  interface Props {
    /** Currently-selected language id (used to highlight the active row). */
    currentLanguage: string;
    onApply: (lang: string) => void;
    onCancel: () => void;
  }

  let { currentLanguage, onApply, onCancel }: Props = $props();

  let popoverEl: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    // Auto-focus on first render so Escape works without an extra
    // click and so screen readers announce the picker.
    popoverEl?.focus();
  });

  function holdFocus(e: MouseEvent): void {
    // Same idiom as the toolbar + LinkPopover apply buttons: clicking
    // a language must NOT blur the editor (which would drop the PM
    // selection that points at our code_block).
    e.preventDefault();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<div
  bind:this={popoverEl}
  class="popover"
  data-testid="code-lang-popover"
  role="listbox"
  aria-label="Code block language"
  tabindex="-1"
  onkeydown={onKeydown}
>
  {#each SUPPORTED_CODE_LANGUAGES as lang (lang.id)}
    <button
      type="button"
      class="lang"
      class:active={lang.id === currentLanguage}
      role="option"
      aria-selected={lang.id === currentLanguage}
      data-testid={`code-lang-option-${lang.id}`}
      onmousedown={holdFocus}
      onclick={() => onApply(lang.id)}
    >
      {lang.label}
    </button>
  {/each}
</div>

<style>
  .popover {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: 0.25rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ccc;
    border-bottom: none;
    background: #fff;
    outline: none;
  }

  .lang {
    appearance: none;
    border: 1px solid #ddd;
    background: #f7f7f8;
    color: inherit;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    cursor: pointer;
    text-align: center;
  }

  .lang:hover {
    border-color: #aaa;
  }

  .lang.active {
    border-color: #5b8def;
    background: #5b8def;
    color: #fff;
  }
</style>
