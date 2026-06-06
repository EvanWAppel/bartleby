<script lang="ts">
  // /n/[id] — open one note. Desktop: title editor + ProseMirror.
  // Mobile: read-only reader + "open on desktop" banner (X-001..X-004).

  import Editor from '$lib/Editor.svelte';
  import MobileReader from '$lib/MobileReader.svelte';
  import DesktopBanner from '$lib/DesktopBanner.svelte';
  import TitleEditor from '$lib/components/TitleEditor.svelte';
  import type { NoteSummary } from '$lib/api/notes';

  interface Props {
    data: { id: string; note: NoteSummary };
  }

  let { data }: Props = $props();
</script>

<div class="desktop">
  {#key data.id}
    <TitleEditor id={data.id} title={data.note.title} />
  {/key}
  <Editor room={data.id} />
</div>

<div class="mobile">
  <header class="topbar">
    <h1>{data.note.title}</h1>
  </header>
  <MobileReader room={data.id} />
  <DesktopBanner />
</div>

<style>
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

  @media (max-width: 767px) {
    .desktop {
      display: none;
    }
    .mobile {
      display: flex;
    }
  }
</style>
