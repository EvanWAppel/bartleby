import { describe, expect, it, vi } from 'vitest';

import { listUsers, UsersApiError } from './users';

describe('users API', () => {
  it('maps the users wire response to the web model', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        users: [
          {
            email: 'alex@example.com',
            display_name: 'Alex',
            user_id: 'user-1',
            color: '#336699',
            signed_in: true,
          },
          {
            email: 'invited@example.com',
            display_name: null,
            user_id: null,
            color: null,
            signed_in: false,
          },
        ],
      }),
    );

    const result = await listUsers({ fetch: fetchMock });

    expect(result).toEqual([
      {
        email: 'alex@example.com',
        displayName: 'Alex',
        userId: 'user-1',
        color: '#336699',
        signedIn: true,
      },
      {
        email: 'invited@example.com',
        displayName: null,
        userId: null,
        color: null,
        signedIn: false,
      },
    ]);
  });

  it('raises a typed error from a structured error response', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 'users_forbidden', message: 'Sign in required' } },
        { status: 401, statusText: 'Unauthorized' },
      ),
    );
    const request = listUsers({ fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(UsersApiError);
    await expect(request).rejects.toMatchObject({
      status: 401,
      code: 'users_forbidden',
      message: 'Sign in required',
    });
  });

  it('falls back to status text when the error body is malformed JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response('', { status: 504, statusText: 'Gateway Timeout' }),
    );
    const request = listUsers({ fetch: fetchMock });

    await expect(request).rejects.toBeInstanceOf(UsersApiError);
    await expect(request).rejects.toMatchObject({
      status: 504,
      code: 'unknown',
      message: 'Gateway Timeout',
    });
  });
});
