// W-023 reactive unread-mentions count for the sidebar badge. Polls
// every 5s — mentions aren't created at high frequency (a per-keystroke
// rate would be wasteful) but we want the badge to clear within a few
// seconds of opening the inbox.

import { listMentions, type MentionDto } from '$lib/api/mentions';

const DEFAULT_POLL_MS = 5_000;

export class MentionsStore {
  unread: MentionDto[] = $state([]);
  loading = $state(true);
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
      this.unread = await listMentions({ unread: true, signal: this.#abort.signal });
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
