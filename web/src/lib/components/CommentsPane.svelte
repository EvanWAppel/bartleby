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

  import { onMount } from 'svelte';
  import {
    createComment,
    deleteComment,
    listComments,
    reopenComment,
    replyToComment,
    resolveComment,
    type CommentDto,
  } from '$lib/api/comments';
  import { listUsers, type UserSummary } from '$lib/api/users';

  interface Props {
    noteId: string;
  }

  let { noteId }: Props = $props();

  let loading = $state(true);
  let error: string | null = $state(null);
  let comments: CommentDto[] = $state([]);
  let users: UserSummary[] = $state([]);
  let includeResolved = $state(false);
  // Composer state for the "New comment" form at the top of the pane.
  let newBody = $state('');
  let submittingNew = $state(false);
  // Per-thread reply-composer open state + drafts. Keyed by thread top
  // id so opening one doesn't close another.
  let replyOpenFor: string | null = $state(null);
  let replyDraft = $state('');
  let submittingReply = $state(false);

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
    for (const c of comments) {
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

  async function refresh(): Promise<void> {
    try {
      comments = await listComments(noteId, { includeResolved });
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    // Fire both fetches in parallel — the users list is small and
    // operator-managed so we treat it as effectively static for the
    // life of the pane (the W-013 UsersStore polls it on a 30s cadence
    // elsewhere in the app; here we only need a one-shot mapping).
    const [_, u] = await Promise.all([refresh(), listUsers().catch(() => [] as UserSummary[])]);
    users = u;
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
      comments = [...comments, created];
      newBody = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
      comments = [...comments, created];
      closeReply();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      submittingReply = false;
    }
  }

  async function toggleResolve(c: CommentDto): Promise<void> {
    try {
      const updated =
        c.resolved_at === null ? await resolveComment(c.id) : await reopenComment(c.id);
      comments = comments.map((x) => (x.id === updated.id ? updated : x));
      // When a thread is resolved and the user hasn't asked for resolved
      // visibility, refresh so the row drops out of the list cleanly.
      if (!includeResolved && updated.resolved_at !== null) {
        await refresh();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function remove(c: CommentDto): Promise<void> {
    try {
      await deleteComment(c.id);
      // Local prune: drop the row and any replies that pointed at it.
      // The server's FK ON DELETE CASCADE handles the same on the row
      // side, but the local state otherwise carries the stale replies
      // until next refresh.
      comments = comments.filter((x) => x.id !== c.id && x.parent_comment_id !== c.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onIncludeResolvedChange(): Promise<void> {
    loading = true;
    await refresh();
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
      bind:checked={includeResolved}
      onchange={() => void onIncludeResolvedChange()}
      data-testid="comments-pane-include-resolved"
    />
    Include resolved
  </label>

  {#if loading}
    <p class="hint" data-testid="comments-pane-loading">Loading comments…</p>
  {:else if error !== null}
    <p class="errortext" data-testid="comments-pane-error">Couldn't load comments: {error}</p>
  {:else if threads.length === 0}
    <p class="hint" data-testid="comments-pane-empty">No comments yet.</p>
  {:else}
    <ul class="threads" data-testid="comments-pane-list">
      {#each threads as thread (thread.top.id)}
        <li
          class="thread"
          class:resolved={thread.top.resolved_at !== null}
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
