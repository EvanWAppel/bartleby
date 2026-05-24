import { describe, it, expect } from 'vitest';
import { loadAllowlist, type EmailAllowlist } from './allowlist.js';

describe('email allowlist (A-001)', () => {
  it('parses comma-separated emails from BARTLEBY_ALLOWED_EMAILS', () => {
    const list: EmailAllowlist = loadAllowlist({
      BARTLEBY_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
    });
    expect(list.has('alice@example.com')).toBe(true);
    expect(list.has('bob@example.com')).toBe(true);
    expect(list.has('eve@example.com')).toBe(false);
  });

  it('lowercases and trims emails (case-insensitive match)', () => {
    const list = loadAllowlist({
      BARTLEBY_ALLOWED_EMAILS: '  Alice@Example.com , bob@example.com  ',
    });
    expect(list.has('alice@example.com')).toBe(true);
    expect(list.has('ALICE@EXAMPLE.COM')).toBe(true);
    expect(list.has('Bob@Example.com')).toBe(true);
  });

  it('ignores empty entries from trailing/leading commas', () => {
    const list = loadAllowlist({
      BARTLEBY_ALLOWED_EMAILS: ',alice@example.com,,bob@example.com,',
    });
    expect(list.size()).toBe(2);
  });

  it('throws loudly if BARTLEBY_ALLOWED_EMAILS is missing', () => {
    expect(() => loadAllowlist({})).toThrowError(/BARTLEBY_ALLOWED_EMAILS/);
  });

  it('throws if BARTLEBY_ALLOWED_EMAILS is empty after parsing', () => {
    expect(() => loadAllowlist({ BARTLEBY_ALLOWED_EMAILS: '  , ,  ' })).toThrowError(
      /BARTLEBY_ALLOWED_EMAILS/,
    );
  });
});
