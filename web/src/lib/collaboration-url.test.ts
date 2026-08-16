import { describe, expect, it } from 'vitest';
import { resolveCollaborationUrl } from './collaboration-url';

describe('resolveCollaborationUrl', () => {
  it('uses a secure same-origin websocket in production', () => {
    expect(resolveCollaborationUrl({ protocol: 'https:', host: 'bartleby.example.com' })).toBe(
      'wss://bartleby.example.com/collaboration',
    );
  });

  it('uses a same-origin websocket during local development', () => {
    expect(resolveCollaborationUrl({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe(
      'ws://127.0.0.1:5173/collaboration',
    );
  });

  it('preserves an explicit server URL', () => {
    expect(
      resolveCollaborationUrl(
        { protocol: 'https:', host: 'bartleby.example.com' },
        'ws://127.0.0.1:4321',
      ),
    ).toBe('ws://127.0.0.1:4321');
  });
});
