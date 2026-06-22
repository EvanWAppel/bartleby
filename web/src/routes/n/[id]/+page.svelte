<script lang="ts">
  // /n/[id] — open one note. Desktop: title editor + ProseMirror.
  // Mobile: read-only reader + "open on desktop" banner (X-001..X-004).

  import Editor from '$lib/Editor.svelte';
  import MobileReader from '$lib/MobileReader.svelte';
  import DesktopBanner from '$lib/DesktopBanner.svelte';
  import TitleEditor from '$lib/components/TitleEditor.svelte';
  import TagChipEditor from '$lib/components/TagChipEditor.svelte';
  import { exportNoteMarkdown, type NoteSummary } from '$lib/api/notes';

  interface Props {
    data: {
      id: string;
      note: NoteSummary;
      // user is merged in from +layout.server.ts; we pass it down to the
      // Editor so W-014 presence can publish { name, color } via the
      // Hocuspocus provider's Yjs awareness without a /auth/me fetch.
      user?: { id: string; display_name: string; color: string };
    };
  }

  let { data }: Props = $props();

  // W-027 "Copy as markdown". The note-options menu in v1 is a single
  // button — we'll grow it into a popover once a second option lands.
  // Two-state feedback ('idle' | 'copied' | 'error') so the user sees
  // the click registered without us pushing a toast component.
  let copyState: 'idle' | 'copied' | 'error' = $state('idle');
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  async function onCopyMarkdown(): Promise<void> {
    try {
      const md = await exportNoteMarkdown(data.id);
      await navigator.clipboard.writeText(md);
      copyState = 'copied';
    } catch {
      copyState = 'error';
    }
    if (resetTimer !== null) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyState = 'idle';
    }, 2_000);
  }
</script>

<div class="desktop">
  {#key data.id}
    <div class="title-row">
      <div class="title-grow">
        <TitleEditor id={data.id} title={data.note.title} />
      </div>
      <button
        type="button"
        class="copy-md"
        data-testid="note-view-copy-markdown"
        data-state={copyState}
        title="Copy this note as markdown"
        onclick={() => void onCopyMarkdown()}
      >
        {#if copyState === 'copied'}
          ✓ Copied
        {:else if copyState === 'error'}
          ✗ Couldn't copy
        {:else}
          Copy as markdown
        {/if}
      </button>
    </div>
    <TagChipEditor id={data.id} tags={data.note.tags} />
  {/key}
  <Editor room={data.id} user={data.user} />
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

  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .title-grow {
    flex: 1;
    min-width: 0;
  }

  .copy-md {
    appearance: none;
    border: 1px solid #cfcfcf;
    background: #fff;
    color: #444;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .copy-md:hover {
    background: #f5f5f5;
  }

  .copy-md[data-state='copied'] {
    border-color: #5b8def;
    color: #5b8def;
  }

  .copy-md[data-state='error'] {
    border-color: #c0392b;
    color: #c0392b;
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
