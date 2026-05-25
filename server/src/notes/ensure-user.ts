// Bridge: A's SessionStore is in-memory today (per A's TODO in
// server/src/auth/store.ts), so the user id in the session is NOT
// guaranteed to exist in D's `users` table. Every S route that writes
// a note (which has `created_by` FK to users.id) goes through this
// helper first.
//
// When A's TODO swaps SessionStore for a D-backed implementation, this
// becomes redundant — but it stays harmless (the first branch hits).

import type { UsersRepository } from '../db/repositories/users.js';
import type { User } from '../auth/index.js';

/**
 * Ensure the given session user is materialized in D's `users` table.
 * Returns the canonical D user id to use as `created_by`.
 *
 * Lookup is by email (normalized). If a row already exists we trust it
 * — we never overwrite display_name / color / created_at, since D may
 * hold older or richer data than the session.
 */
export function ensureUserExists(users: UsersRepository, sessionUser: User): string {
  const normalizedEmail = sessionUser.email.trim().toLowerCase();
  const existing = users.findByEmail(normalizedEmail);
  if (existing !== undefined) {
    return existing.id;
  }

  const row = {
    id: sessionUser.id,
    email: normalizedEmail,
    display_name: sessionUser.displayName,
    color: sessionUser.color,
    created_at: sessionUser.createdAt.toISOString(),
  };
  users.insert(row);
  return row.id;
}
