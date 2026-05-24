// A-001: Email allowlist loaded from BARTLEBY_ALLOWED_EMAILS at startup.
//
// PRD §9.1: "Server holds a hardcoded `allowed_emails` list. Any successful
// OAuth response with an email not on the list is rejected at the
// session-creation step." Onboarding = operator edits the env var and redeploys.

export interface EmailAllowlist {
  has(email: string): boolean;
  size(): number;
  values(): readonly string[];
}

export class AllowlistConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowlistConfigError';
  }
}

export function loadAllowlist(env: Record<string, string | undefined>): EmailAllowlist {
  const raw = env.BARTLEBY_ALLOWED_EMAILS;
  if (raw === undefined) {
    throw new AllowlistConfigError(
      'BARTLEBY_ALLOWED_EMAILS is required (comma-separated list of allowed emails). ' +
        'Per PRD §9.1, no user can sign in without being on this list.',
    );
  }
  const emails = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (emails.length === 0) {
    throw new AllowlistConfigError(
      'BARTLEBY_ALLOWED_EMAILS parsed to an empty list. ' + 'At least one email is required.',
    );
  }
  const set = new Set(emails);
  return {
    has(email: string) {
      return set.has(email.trim().toLowerCase());
    },
    size() {
      return set.size;
    },
    values() {
      return Array.from(set);
    },
  };
}
