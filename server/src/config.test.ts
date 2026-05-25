import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig (O-008)', () => {
  it('returns defaults when env is empty', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(1234);
    expect(config.BARTLEBY_BIND_ADDRESS).toBe('127.0.0.1');
    expect(config.BARTLEBY_DB_PATH).toBe(':memory:');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string to number', () => {
    const config = loadConfig({ PORT: '5555' });
    expect(config.PORT).toBe(5555);
  });

  it('rejects a non-numeric PORT with a clear message', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrowError(/PORT.*expected number/i);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrowError(/PORT.*<=.*65535/i);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'shout' })).toThrowError(/LOG_LEVEL/);
  });

  it('rejects a too-short SESSION_SECRET when supplied', () => {
    // SESSION_SECRET is optional today but, when given, must be 32+ chars.
    expect(() => loadConfig({ SESSION_SECRET: 'too-short' })).toThrowError(
      /SESSION_SECRET.*at least 32/,
    );
  });

  it('accepts a long SESSION_SECRET', () => {
    const config = loadConfig({ SESSION_SECRET: 'x'.repeat(64) });
    expect(config.SESSION_SECRET).toHaveLength(64);
  });

  it('rejects a non-URL PUBLIC_BASE_URL', () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'not a url' })).toThrowError(/PUBLIC_BASE_URL/);
  });

  it('aggregates multiple errors in one message', () => {
    expect(() =>
      loadConfig({ PORT: 'nope', LOG_LEVEL: 'shout', PUBLIC_BASE_URL: 'oops' }),
    ).toThrowError(/PORT[\s\S]+LOG_LEVEL[\s\S]+PUBLIC_BASE_URL/);
  });
});
