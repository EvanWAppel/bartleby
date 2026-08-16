// Users REST wire contract. Powers the @mention picker. The server returns
// snake_case rows; the web api layer maps these into a camelCase
// `UserSummary` for components, so that transform type stays web-side —
// only the wire shape lives here.

/**
 * One user as returned by GET /users. Non-id fields are null for
 * allowlist-only entries (invited but never signed in).
 */
export interface UserWire {
  email: string;
  display_name: string | null;
  user_id: string | null;
  color: string | null;
  signed_in: boolean;
}

/** GET /users. */
export interface UsersListResponse {
  users: UserWire[];
}
