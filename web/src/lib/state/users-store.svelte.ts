// W-013: reactive users-list state for the @mention picker. We don't
// need fast-changing refresh — the allowlist is operator-managed and
// changes on a redeploy cadence, and signed-in updates only happen on
// fresh logins. One-shot fetch on editor mount is enough; we also
// expose start()/stop() symmetric to NotesStore so a future SSE/WS push
// can drop in without an API change.

import { listUsers, type UserSummary } from '../api/users';

const DEFAULT_POLL_MS = 30_000;

export class UsersStore {
  users: UserSummary[] = $state([]);
  loading: boolean = $state(true);
  error: string | null = $state(null);

  #handle: ReturnType<typeof setInterval> | null = null;
  #abort: AbortController | null = null;
  readonly #pollMs: number;

  constructor(pollMs: number = DEFAULT_POLL_MS) {
    this.#pollMs = pollMs;
  }

  async refresh(): Promise<void> {
    this.#abort?.abort();
    this.#abort = new AbortController();
    try {
      const next = await listUsers({ signal: this.#abort.signal });
      this.users = next;
      this.error = null;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  start(): void {
    if (this.#handle !== null) return;
    void this.refresh();
    this.#handle = setInterval(() => {
      void this.refresh();
    }, this.#pollMs);
  }

  stop(): void {
    if (this.#handle !== null) {
      clearInterval(this.#handle);
      this.#handle = null;
    }
    this.#abort?.abort();
    this.#abort = null;
  }
}
