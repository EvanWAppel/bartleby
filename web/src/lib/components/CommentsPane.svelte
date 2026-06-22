<script lang="ts">
  // W-017 comments pane. Renders the per-note comment threads + a
  // composer for new top-level comments. Each top-level comment shows:
  //   - author display name (best-effort via UsersStore) + body + age,
  //   - any replies underneath,
  //   - a "Reply" affordance that toggles an inline composer,
  //   - a "Resolve" / "Reopen" toggle,
  //   - a "Delete" affordance (top-level deletes the whole thread).
  //
  // W-018 owns the in-body selection → "Comment" floating-toolbar UX
  // and the per-comment numbered markers in the editor. This PR ships
  // the pane-side CRUD with an anchor-less composer ("New comment" at
  // the top of the pane). The server's anchor column is nullable-in-
  // practice (empty string is allowed) so W-018 can fill it in later
  // without a schema change.
  //
  // Data model: the server returns a flat list of CommentDto rows. We
  // group on the client into Thread = { top: CommentDto, replies:
  // CommentDto[] } so the rendering can naturally show parent → child
  // without a recursive component. Resolved threads are excluded by
  // default (the server filters them out unless ?include=resolved) so
  // the pane reads as the active conversation; an "Include resolved"
  // toggle surfaces the full archive without leaving the pane.

  import { onMount, onDestroy, tick } from 'svelte';
  import {
    createComment,
    deleteComment,
    reopenComment,
    replyToComment,
    resolveComment,
    type CommentDto,
  } from '$lib/api/comments';
  import { listUsers, type UserSummary } from '$lib/api/users';
  import { getCommentsStore } from '$lib/state/comments-store.svelte';

  interface Props {
    noteId: string;
  }

  let { noteId }: Props = $props();

  // Shared store between Editor.svelte (for body markers) and this
  // pane. attach/detach maintain a refcount; the store auto-evicts
  // when the last consumer unmounts. NoteRightPane keys on noteId so
  // the value is stable per mount; we use $derived to silence the
  // state-referenced-locally compiler warning without changing
  // behaviour.
  const store = $derived(getCommentsStore(noteId));

  let users: UserSummary[] = $state([]);
  // Composer state for the "New comment" form at the top of the pane.
  let newBody = $state('');
  let submittingNew = $state(false);
  // Per-thread reply-composer open state + drafts. Keyed by thread top
  // id so opening one doesn't close another.
  let replyOpenFor: string | null = $state(null);
  let replyDraft = $state('');
  let submittingReply = $state(false);
  // W-018 marker focus: which thread the editor's marker click is
  // pointing at. Cleared on click anywhere or after a few seconds —
  // we just want a brief visual ping, not sticky highlight.
  let focusedThreadId: string | null = $state(null);
  let threadCardEls: Record<string, HTMLLIElement | null> = $state({});

  interface Thread {
    top: CommentDto;
    replies: CommentDto[];
  }

  let threads = $derived.by<Thread[]>(() => {
    // Group by parent_comment_id. Top-level comments are those where
    // parent_comment_id is null; everything else gets attached under
    // its parent. We deliberately don't try to resolve replies whose
    // parent was deleted — a delete cascade-removes them via the FK in
    // the schema, so they shouldn't show up.
    const tops: CommentDto[] = [];
    const byParent = new Map<string, CommentDto[]>();
    for (const c of store.comments) {
      if (c.parent_comment_id === null) {
        tops.push(c);
      } else {
        const list = byParent.get(c.parent_comment_id);
        if (list === undefined) byParent.set(c.parent_comment_id, [c]);
        else list.push(c);
      }
    }
    return tops.map((top) => ({ top, replies: byParent.get(top.id) ?? [] }));
  });

  async function focusThread(commentId: string): Promise<void> {
    focusedThreadId = commentId;
    await tick();
    const el = threadCardEls[commentId];
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Ping the highlight for a couple seconds then drop it.
    setTimeout(() => {
      if (focusedThreadId === commentId) focusedThreadId = null;
    }, 2000);
  }

  function onFocusEvent(e: Event): void {
    const detail = (e as CustomEvent<{ noteId?: string; commentId?: string }>).detail;
    if (detail.noteId !== noteId || typeof detail.commentId !== 'string') return;
    void focusThread(detail.commentId);
  }

  onMount(async () => {
    store.attach();
    const u = await listUsers().catch(() => [] as UserSummary[]);
    users = u;
    window.addEventListener('bartleby:focus-comment', onFocusEvent);
    // Replay a marker-click that landed in localStorage before the
    // pane mounted (the editor wrote it, the user switched tab, and
    // by the time CommentsPane is alive the event has already fired).
    try {
      const pending = window.localStorage.getItem(`bartleby:comments:focus:${noteId}`);
      if (pending !== null && pending.length > 0) {
        window.localStorage.removeItem(`bartleby:comments:focus:${noteId}`);
        await focusThread(pending);
      }
    } catch {
      // localStorage failures are non-fatal.
    }
  });

  onDestroy(() => {
    // onDestroy fires during SSR cleanup too — guard the window access
    // so the prerender pass doesn't crash with "window is not defined".
    if (typeof window !== 'undefined') {
      window.removeEventListener('bartleby:focus-comment', onFocusEvent);
    }
    store.detach();
  });

  function authorLabel(authorId: string): string {
    const u = users.find((x) => x.userId === authorId);
    if (u === undefined) return authorId;
    if (u.displayName !== null && u.displayName.length > 0) return u.displayName;
    return u.email;
  }

  async function submitNew(): Promise<void> {
    const text = newBody.trim();
    if (text.length === 0) return;
    submittingNew = true;
    try {
      const created = await createComment(noteId, { body: text });
      store.insertLocal(created);
      newBody = '';
    } catch (e) {
      store.error = e instanceof Error ? e.message : String(e);
    } finally {
      submittingNew = false;
    }
  }

  function openReply(topId: string): void {
    replyOpenFor = topId;
    replyDraft = '';
  }

  function closeReply(): void {
    replyOpenFor = null;
    replyDraft = '';
  }

  async function submitReply(topId: string): Promise<void> {
    const text = replyDraft.trim();
    if (text.length === 0) return;
    submittingReply = true;
    try {
      const created = await replyToComment(topId, text);
      store.insertLocal(created);
      closeReply();
    } catch (e) {
      store.error = e instanceof Error ? e.message : String(e);
    } finally {
      submittingReply = false;
    }
  }

  async function toggleResolve(c: CommentDto): Promise<void> {
    try {
      const updated =
        c.resolved_at === null ? await resolveComment(c.id) : await reopenComment(c.id);
      store.updateLocal(updated);
      // When a thread is resolved and the user hasn't asked for resolved
      // visibility, refresh so the row drops out of the list cleanly.
      if (!store.includeResolved && updated.resolved_at !== null) {
        await store.refresh();
      }
    } catch (e) {
      store.error = e instanceof Error ? e.message : String(e);
    }
  }

  async function remove(c: CommentDto): Promise<void> {
    try {
      await deleteComment(c.id);
      // Local prune: drop the row and any replies that pointed at it.
      // The server's FK ON DELETE CASCADE handles the same on the row
      // side, but the local state otherwise carries the stale replies
      // until next refresh.
      store.removeLocal(c.id);
    } catch (e) {
      store.error = e instanceof Error ? e.message : String(e);
    }
  }

  function onIncludeResolvedChange(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    void store.setIncludeResolved(checked);
  }
</script>

<div class="comments" data-testid="comments-pane">
  <form
    class="composer"
    data-testid="comments-pane-new-form"
    onsubmit={(e) => {
      e.preventDefault();
      void submitNew();
    }}
  >
    <textarea
      class="textarea"
      data-testid="comments-pane-new-body"
      placeholder="Leave a comment…"
      bind:value={newBody}
      rows="2"
    ></textarea>
    <div class="actions">
      <button
        type="submit"
        class="btn primary"
        data-testid="comments-pane-new-submit"
        disabled={submittingNew || newBody.trim().length === 0}
      >
        Post
      </button>
    </div>
  </form>

  <label class="filter" data-testid="comments-pane-filter">
    <input
      type="checkbox"
      checked={store.includeResolved}
      onchange={onIncludeResolvedChange}
      data-testid="comments-pane-include-resolved"
    />
    Include resolved
  </label>

  {#if store.loading}
    <p class="hint" data-testid="comments-pane-loading">Loading comments…</p>
  {:else if store.error !== null}
    <p class="errortext" data-testid="comments-pane-error">
      Couldn't load comments: {store.error}
    </p>
  {:else if threads.length === 0}
    <p class="hint" data-testid="comments-pane-empty">No comments yet.</p>
  {:else}
    <ul class="threads" data-testid="comments-pane-list">
      {#each threads as thread (thread.top.id)}
        <li
          bind:this={threadCardEls[thread.top.id]}
          class="thread"
          class:resolved={thread.top.resolved_at !== null}
          class:focused={focusedThreadId === thread.top.id}
          data-testid={`comments-thread-${thread.top.id}`}
        >
          <div class="row top">
            <div class="head">
              <span class="author">{authorLabel(thread.top.author_id)}</span>
              {#if thread.top.resolved_at !== null}
                <span class="badge" data-testid={`comments-thread-resolved-${thread.top.id}`}
                  >resolved</span
                >
              {/if}
            </div>
            <p class="body" data-testid={`comments-thread-body-${thread.top.id}`}>
              {thread.top.body}
            </p>
          </div>

          {#each thread.replies as reply (reply.id)}
            <div class="row reply" data-testid={`comments-reply-${reply.id}`}>
              <div class="head">
                <span class="author">{authorLabel(reply.author_id)}</span>
              </div>
              <p class="body" data-testid={`comments-reply-body-${reply.id}`}>{reply.body}</p>
            </div>
          {/each}

          {#if replyOpenFor === thread.top.id}
            <form
              class="reply-composer"
              data-testid={`comments-thread-reply-form-${thread.top.id}`}
              onsubmit={(e) => {
                e.preventDefault();
                void submitReply(thread.top.id);
              }}
            >
              <textarea
                class="textarea small"
                placeholder="Reply…"
                bind:value={replyDraft}
                rows="2"
                data-testid={`comments-thread-reply-body-${thread.top.id}`}
              ></textarea>
              <div class="actions">
                <button
                  type="submit"
                  class="btn primary"
                  data-testid={`comments-thread-reply-submit-${thread.top.id}`}
                  disabled={submittingReply || replyDraft.trim().length === 0}
                >
                  Reply
                </button>
                <button type="button" class="btn" onclick={closeReply}>Cancel</button>
              </div>
            </form>
          {/if}

          <div class="thread-actions">
            {#if replyOpenFor !== thread.top.id}
              <button
                type="button"
                class="link"
                data-testid={`comments-thread-reply-open-${thread.top.id}`}
                onclick={() => openReply(thread.top.id)}
              >
                Reply
              </button>
            {/if}
            <button
              type="button"
              class="link"
              data-testid={`comments-thread-resolve-${thread.top.id}`}
              onclick={() => void toggleResolve(thread.top)}
            >
              {thread.top.resolved_at === null ? 'Resolve' : 'Reopen'}
            </button>
            <button
              type="button"
              class="link danger"
              data-testid={`comments-thread-delete-${thread.top.id}`}
              onclick={() => void remove(thread.top)}
            >
              Delete
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100%;
    overflow: auto;
  }

  .composer,
  .reply-composer {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .textarea {
    appearance: none;
    width: 100%;
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
    gap: 0.35rem;
    justify-content: flex-end;
  }

  .btn {
    appearance: none;
    border: 1px solid #ccc;
    background: #fff;
    color: #444;
    padding: 0.25rem 0.5rem;
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

  .filter {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: #555;
  }

  .hint,
  .errortext {
    margin: 0;
    font-size: 0.85rem;
  }
  .hint {
    color: #888;
    font-style: italic;
  }
  .errortext {
    color: #c0392b;
  }

  .threads {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .thread {
    border: 1px solid #e0e0e0;
    background: #fff;
    border-radius: 4px;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .thread.resolved {
    opacity: 0.6;
  }

  .thread.focused {
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .row.reply {
    border-left: 2px solid #e0e0e0;
    margin-left: 0.5rem;
    padding-left: 0.5rem;
  }

  .head {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    font-size: 0.75rem;
    color: #666;
  }

  .author {
    font-weight: 500;
    color: #444;
  }

  .badge {
    background: #eef3ff;
    color: #5b8def;
    padding: 0.05rem 0.25rem;
    border-radius: 3px;
    font-size: 0.65rem;
  }

  .body {
    margin: 0;
    font-size: 0.85rem;
    color: #222;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .thread-actions {
    display: flex;
    gap: 0.35rem;
    font-size: 0.75rem;
    margin-top: 0.25rem;
  }

  .link {
    appearance: none;
    background: transparent;
    border: none;
    color: #5b8def;
    padding: 0;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link.danger {
    color: #c0392b;
  }

  .textarea.small {
    font-size: 0.8rem;
  }
</style>
