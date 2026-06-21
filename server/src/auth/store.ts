// In-memory session store for Workstream A.
//
// TODO(D-001..D-002, D-011): Once the SQLite users table and repository layer
// land, replace this with a DB-backed implementation. The interface below is
// intentionally narrow so the swap is mechanical. Note that on swap, the
// deterministic color logic should move to a one-shot at user creation
// (PRD §8.1: "Per-user color assigned at user creation and reused everywhere").

import { createHash, randomUUID } from 'node:crypto';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly color: string;
  readonly createdAt: Date;
}

export interface UpsertUserInput {
  email: string;
  displayName: string;
}

export interface SessionStore {
  upsertUserByEmail(input: UpsertUserInput): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  /**
   * Returns every user the store knows about (i.e., has been seen via
   * upsertUserByEmail), sorted by lowercase email. W-013's GET /users
   * uses this as the signed-in half of the allowlist∪users union it
   * serves to the @mention picker.
   */
  listUsers(): Promise<User[]>;
  revokeJti(jti: string): Promise<void>;
  isJtiRevoked(jti: string): Promise<boolean>;
}

// Tasteful palette of distinguishable hex colors. Per PRD §8.1 a color is
// assigned at user creation; we hash the email so two devs running locally
// land on the same color for the same friend.
const PRESENCE_PALETTE: readonly string[] = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#9a6324',
  '#800000',
  '#808000',
  '#000075',
  '#469990',
];

function pickColor(email: string): string {
  const digest = createHash('sha256').update(email).digest();
  const firstByte = digest[0] ?? 0;
  const idx = firstByte % PRESENCE_PALETTE.length;
  const picked = PRESENCE_PALETTE[idx];
  // Palette is a non-empty const array and idx is bounded by its length.
  if (picked === undefined) {
    throw new Error('unreachable: empty palette');
  }
  return picked;
}

export function createInMemorySessionStore(): SessionStore {
  const usersByEmail = new Map<string, User>();
  const usersById = new Map<string, User>();
  const revokedJtis = new Set<string>();

  return {
    async upsertUserByEmail({ email, displayName }: UpsertUserInput): Promise<User> {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = usersByEmail.get(normalizedEmail);
      if (existing !== undefined) {
        const updated: User = { ...existing, displayName };
        usersByEmail.set(normalizedEmail, updated);
        usersById.set(updated.id, updated);
        return updated;
      }
      const user: User = {
        id: randomUUID(),
        email: normalizedEmail,
        displayName,
        color: pickColor(normalizedEmail),
        createdAt: new Date(),
      };
      usersByEmail.set(normalizedEmail, user);
      usersById.set(user.id, user);
      return user;
    },

    async getUserById(id: string): Promise<User | null> {
      return usersById.get(id) ?? null;
    },

    async listUsers(): Promise<User[]> {
      return [...usersByEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
    },

    async revokeJti(jti: string): Promise<void> {
      revokedJtis.add(jti);
    },

    async isJtiRevoked(jti: string): Promise<boolean> {
      return revokedJtis.has(jti);
    },
  };
}
