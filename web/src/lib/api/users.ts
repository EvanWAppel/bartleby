// W-013: typed wrapper over the bartleby GET /users endpoint. Powers
// the @mention picker. Request goes through the SvelteKit-side proxy
// (configured in vite.config.ts) so the browser sees a same-origin URL.

export interface UserSummary {
  /** Always present — stable identifier. */
  email: string;
  /** null when the user hasn't signed in yet (allowlist-only entry). */
  displayName: string | null;
  /** null when the user hasn't signed in yet. */
  userId: string | null;
  /** null when the user hasn't signed in yet. */
  color: string | null;
  /** True iff the user exists in the server's users table. */
  signedIn: boolean;
}

interface UsersListResponse {
  users: {
    email: string;
    display_name: string | null;
    user_id: string | null;
    color: string | null;
    signed_in: boolean;
  }[];
}

export class UsersApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'UsersApiError';
  }
}

type FetchLike = typeof fetch;

async function parseError(res: Response): Promise<UsersApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new UsersApiError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new UsersApiError(res.status, 'unknown', res.statusText);
  }
}

export interface ListUsersOptions {
  signal?: AbortSignal;
  fetch?: FetchLike;
}

export async function listUsers(opts: ListUsersOptions = {}): Promise<UserSummary[]> {
  const f = opts.fetch ?? fetch;
  const res = await f('/users', {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as UsersListResponse;
  return body.users.map((u) => ({
    email: u.email,
    displayName: u.display_name,
    userId: u.user_id,
    color: u.color,
    signedIn: u.signed_in,
  }));
}
