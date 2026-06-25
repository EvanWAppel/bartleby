<script lang="ts">
  // W-023 mentions inbox. List of unread + recent mentions; clicking a
  // row marks it as read (M-004) AND navigates to the source note.
  //
  // We split the list into two sections — Unread up top (with the bold
  // "X new" badge) and Read below — so the user sees what needs
  // attention first. Marking-as-read is optimistic: the row's `read_at`
  // is filled in locally before the navigation completes; if the POST
  // fails the navigation still happens and a manual reload re-syncs.

  import { goto, invalidateAll } from '$app/navigation';
  import { markMentionRead, type MentionDto } from '$lib/api/mentions';

  interface Props {
    data: { mentions: MentionDto[] };
  }

  let { data }: Props = $props();

  // Local overlay so optimistic read-marks stick until invalidateAll
  // re-pulls. Keyed by mention id → the ISO timestamp we set.
  let optimisticReadAt = $state<Record<string, string>>({});

  let mentions = $derived<MentionDto[]>(
    data.mentions.map((m) =>
      optimisticReadAt[m.id] !== undefined ? { ...m, read_at: optimisticReadAt[m.id]! } : m,
    ),
  );

  let unread = $derived<MentionDto[]>(mentions.filter((m) => m.read_at === null));
  let read = $derived<MentionDto[]>(mentions.filter((m) => m.read_at !== null));

  async function onPick(m: MentionDto): Promise<void> {
    // Mark-as-read fire-and-forget; we don't await before navigating so
    // a slow network doesn't delay the user's main intent (jump to the
    // referenced note).
    if (m.read_at === null) {
      optimisticReadAt = { ...optimisticReadAt, [m.id]: new Date().toISOString() };
      void markMentionRead(m.id).catch(() => {
        // best-effort; the canonical state re-syncs on the next page load
      });
    }
    await goto(`/n/${m.note_id}`);
    void invalidateAll();
  }

  function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function snippet(m: MentionDto): string {
    return m.source.startsWith('comment:') ? 'in a comment' : 'in the note body';
  }
</script>

<svelte:head>
  <title>Inbox · Bartleby</title>
</svelte:head>

<div class="inbox" data-testid="inbox-page">
  <header class="header">
    <h1>Mentions</h1>
    <p class="hint" data-testid="inbox-page-unread-count">
      {#if unread.length === 0}
        No unread mentions.
      {:else}
        {unread.length} unread mention{unread.length === 1 ? '' : 's'}.
      {/if}
    </p>
  </header>

  {#if mentions.length === 0}
    <p class="empty" data-testid="inbox-page-empty">
      Nobody has mentioned you yet. Other users will see this list when their notes or comments
      mention your email.
    </p>
  {:else}
    {#if unread.length > 0}
      <section class="section" data-testid="inbox-section-unread">
        <h2 class="section-title">Unread</h2>
        <ul class="list">
          {#each unread as mention (mention.id)}
            <li class="row unread" data-testid={`inbox-row-${mention.id}`}>
              <button
                type="button"
                class="rowbtn"
                data-testid={`inbox-row-open-${mention.id}`}
                onclick={() => void onPick(mention)}
              >
                <span class="title">{mention.note_title}</span>
                <span class="meta">{snippet(mention)} · {formatTimestamp(mention.created_at)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if read.length > 0}
      <section class="section" data-testid="inbox-section-read">
        <h2 class="section-title">Earlier</h2>
        <ul class="list">
          {#each read as mention (mention.id)}
            <li class="row" data-testid={`inbox-row-${mention.id}`}>
              <button
                type="button"
                class="rowbtn"
                data-testid={`inbox-row-open-${mention.id}`}
                onclick={() => void onPick(mention)}
              >
                <span class="title">{mention.note_title}</span>
                <span class="meta">{snippet(mention)} · {formatTimestamp(mention.created_at)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .inbox {
    max-width: 48rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
  }

  .hint {
    margin: 0;
    color: #666;
    font-size: 0.85rem;
  }

  /* Q-005: WCAG AA — #888 on #fff is 3.54:1; #6f6f6f hits 4.55:1. */
  .empty {
    color: #6f6f6f;
    font-style: italic;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    background: #fff;
  }

  .row.unread {
    border-color: #5b8def;
    background: #eef3ff;
  }

  .rowbtn {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .rowbtn:hover {
    background: rgba(91, 141, 239, 0.08);
  }

  .title {
    font-size: 0.95rem;
    color: #222;
  }

  .row.unread .title {
    font-weight: 600;
  }

  .meta {
    font-size: 0.75rem;
    color: #666;
  }
</style>
