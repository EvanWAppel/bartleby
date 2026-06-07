<script lang="ts">
  // W-008 editor toolbar. 11 buttons in 4 groups:
  //
  //   marks   : Bold, Italic, Strike, Link
  //   blocks  : H1, H2, H3
  //   lists   : Bullet, Ordered
  //   wrapped : Blockquote, Code block
  //
  // The link button calls window.prompt for the URL — Playwright
  // intercepts via page.on('dialog'). A real popover is W-009's
  // Cmd-K-link territory; prompt() is the v1 placeholder.

  import type { ToolbarActions } from '$lib/editor/actions';

  let { actions }: { actions: ToolbarActions } = $props();

  // Standard ProseMirror toolbar idiom: preventDefault on mousedown so
  // the button never steals focus from the editor. Without this, the
  // click sequence blurs the editor first (which can sync a stale
  // selection out via y-prosemirror) and then runs the command on a
  // state that no longer matches what the user is looking at.
  function holdFocus(e: MouseEvent): void {
    e.preventDefault();
  }

  function onLinkClick(): void {
    const url = window.prompt('Link URL (empty = unlink)');
    if (url === null) return; // user canceled the prompt
    actions.toggleLink(url.length === 0 ? null : url);
  }
</script>

<div class="toolbar" data-testid="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-bold"
    aria-label="Bold"
    onclick={actions.toggleBold}
  >
    <b>B</b>
  </button>
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-italic"
    aria-label="Italic"
    onclick={actions.toggleItalic}
  >
    <i>I</i>
  </button>
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-strike"
    aria-label="Strike"
    onclick={actions.toggleStrike}
  >
    <s>S</s>
  </button>
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-link"
    aria-label="Link"
    onclick={onLinkClick}>🔗</button
  >

  <span class="sep" aria-hidden="true"></span>

  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-h1"
    aria-label="Heading 1"
    onclick={() => actions.setHeading(1)}>H1</button
  >
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-h2"
    aria-label="Heading 2"
    onclick={() => actions.setHeading(2)}>H2</button
  >
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-h3"
    aria-label="Heading 3"
    onclick={() => actions.setHeading(3)}>H3</button
  >

  <span class="sep" aria-hidden="true"></span>

  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-bullet-list"
    aria-label="Bullet list"
    onclick={actions.toggleBulletList}>•</button
  >
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-ordered-list"
    aria-label="Ordered list"
    onclick={actions.toggleOrderedList}>1.</button
  >

  <span class="sep" aria-hidden="true"></span>

  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-blockquote"
    aria-label="Blockquote"
    onclick={actions.toggleBlockquote}>“</button
  >
  <button
    type="button"
    onmousedown={holdFocus}
    data-testid="tb-code-block"
    aria-label="Code block"
    onclick={actions.toggleCodeBlock}>{'<>'}</button
  >
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ccc;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: #f7f7f8;
  }

  .toolbar button {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    border-radius: 4px;
    padding: 0.2rem 0.45rem;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
    min-width: 1.7rem;
  }

  .toolbar button:hover {
    background: #fff;
    border-color: #ddd;
  }

  .toolbar button:focus-visible {
    outline: 2px solid #5b8def;
    outline-offset: 1px;
  }

  .sep {
    display: inline-block;
    width: 1px;
    height: 1rem;
    background: #ddd;
    margin: 0 0.15rem;
  }
</style>
