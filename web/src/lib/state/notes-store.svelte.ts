// Reactive notes-list state, polled every 1s. PRD spec: list reflects
// remote creates/renames/deletes within 1s. Simplest implementation
// that fits the spec; SSE / WS push is a later optimization once we
// have more bandwidth to burn.

import { listNotes, type NoteSummary } from '../api/notes';

const DEFAULT_POLL_MS = 1000;

export class NotesStore {
  notes: NoteSummary[] = $state([]);
  loading: boolean = $state(true);
  error: string | null = $state(null);

  #handle: ReturnType<typeof setInterval> | null = null;
  #abort: AbortController | null = null;
  readonly #pollMs: number;

  constructor(pollMs: number = DEFAULT_POLL_MS) {
    this.#pollMs = pollMs;
  }

  /** One-shot fetch. Returns a promise so callers can await initial load. */
  async refresh(): Promise<void> {
    this.#abort?.abort();
    this.#abort = new AbortController();
    try {
      const next = await listNotes({ signal: this.#abort.signal });
      this.notes = next;
      this.error = null;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** Start polling. Idempotent. */
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
