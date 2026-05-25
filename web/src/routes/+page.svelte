<script lang="ts">
  import Editor from '$lib/Editor.svelte';
  import MobileReader from '$lib/MobileReader.svelte';
  import DesktopBanner from '$lib/DesktopBanner.svelte';
</script>

<!--
  CSS-driven mobile/desktop split (X-001/X-002): below 768px we render the
  read-only reader + the "open on desktop" banner; at 768px and above we
  render the full ProseMirror editor. Toggling via CSS rather than
  matchMedia keeps SSR honest and avoids a flash of the wrong layout.
-->
<main class="desktop">
  <h1>Bartleby</h1>
  <p data-testid="bootstrap">Vertical slice (V-005). Type below; edits sync via Hocuspocus.</p>
  <Editor />
</main>

<div class="mobile">
  <header class="topbar">
    <h1>Bartleby</h1>
  </header>
  <MobileReader />
  <DesktopBanner />
</div>

<style>
  /* Desktop: full editor, mobile shell hidden. */
  .desktop {
    font-family: system-ui, sans-serif;
    max-width: 48rem;
    margin: 4rem auto;
    padding: 0 1rem;
  }

  .mobile {
    display: none;
    font-family: system-ui, sans-serif;
    min-height: 100vh;
    flex-direction: column;
  }

  .topbar {
    padding: 0.75rem 1rem;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }

  .topbar h1 {
    margin: 0;
    font-size: 1.15rem;
  }

  /* Below 768px (phones): hide desktop, show mobile shell. */
  @media (max-width: 767px) {
    .desktop {
      display: none;
    }
    .mobile {
      display: flex;
    }
  }
</style>
