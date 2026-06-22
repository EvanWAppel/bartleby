// W-018 shared comments store. Editor.svelte (for body markers) and
// CommentsPane.svelte (for the thread list) need to consume the same
// per-note comment list — when the W-018 selection composer posts a
// new comment, both surfaces must update without a tab switch or
// reload.
//
// SvelteKit's layout/page tree puts the editor and the right pane on
// the same level (both rendered as children of the layout) so context
// can't flow between them. A module-level singleton keyed by noteId
// is the simplest cross-cutting state — both call getCommentsStore(id)
// and get the same instance.
//
// The store is intentionally a thin wrapper around the comments API.
// It does NOT poll — comments are user-driven (post / reply / resolve)
// and the editor + pane both call `refresh()` after a mutation. Cross-
// session changes (someone else posts a comment on the same note) are
// not reflected until reload; that's fine for v1 and gets a real-time
// upgrade alongside C-008's orphan-detection / awareness work later.

import { listComments, type CommentDto } from '$lib/api/comments';

const stores = new Map<string, CommentsStore>();

export class CommentsStore {
  readonly noteId: string;
  comments: CommentDto[] = $state([]);
  includeResolved = $state(false);
  loading = $state(true);
  error: string | null = $state(null);

  // Refcount mounted consumers. When the last consumer unmounts we
  // evict from the singleton registry so memory doesn't accumulate as
  // the user navigates between dozens of notes. The COUNT is internal
  // to the registry helpers; consumers just call attach/detach.
  #refcount = 0;

  constructor(noteId: string) {
    this.noteId = noteId;
  }

  attach(): void {
    this.#refcount += 1;
    if (this.#refcount === 1) {
      void this.refresh();
    }
  }

  detach(): void {
    this.#refcount = Math.max(0, this.#refcount - 1);
    if (this.#refcount === 0) {
      stores.delete(this.noteId);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.comments = await listComments(this.noteId, {
        includeResolved: this.includeResolved,
      });
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** Add a freshly-created comment in-place (avoids a refetch hop). */
  insertLocal(c: CommentDto): void {
    this.comments = [...this.comments, c];
  }

  /** Replace an updated comment in-place. */
  updateLocal(c: CommentDto): void {
    this.comments = this.comments.map((x) => (x.id === c.id ? c : x));
  }

  /** Prune a deleted comment (and its replies) in-place. */
  removeLocal(id: string): void {
    this.comments = this.comments.filter((x) => x.id !== id && x.parent_comment_id !== id);
  }

  /** Toggle the include-resolved filter and refetch. */
  async setIncludeResolved(v: boolean): Promise<void> {
    if (this.includeResolved === v) return;
    this.includeResolved = v;
    await this.refresh();
  }
}

export function getCommentsStore(noteId: string): CommentsStore {
  let store = stores.get(noteId);
  if (store === undefined) {
    store = new CommentsStore(noteId);
    stores.set(noteId, store);
  }
  return store;
}
