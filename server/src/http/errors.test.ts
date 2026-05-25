import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { BartlebyHttpError, NotFoundError, ValidationError, errorHandler } from './errors.js';

describe('error model (S-012)', () => {
  it('BartlebyHttpError carries status + code + message', () => {
    const err = new BartlebyHttpError(418, 'teapot', "I'm a teapot");
    expect(err.status).toBe(418);
    expect(err.code).toBe('teapot');
    expect(err.message).toBe("I'm a teapot");
    expect(err).toBeInstanceOf(Error);
  });

  it('NotFoundError is a 404 with code "not_found"', () => {
    const err = new NotFoundError('note', 'abc');
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toContain('note');
    expect(err.message).toContain('abc');
  });

  it('ValidationError is a 400 with code "validation_failed"', () => {
    const err = new ValidationError('title is required');
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_failed');
  });

  const app = new Hono();
  app.onError(errorHandler());
  app.get('/typed', () => {
    throw new BartlebyHttpError(403, 'forbidden', 'no');
  });
  app.get('/raw', () => {
    throw new Error('boom');
  });
  app.get('/notfound', () => {
    throw new NotFoundError('note', 'xyz');
  });

  it('serializes BartlebyHttpError as {error:{code,message}} with the right status', async () => {
    const res = await app.request('/typed');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code: 'forbidden', message: 'no' } });
  });

  it('serializes an unknown thrown Error as 500 with code "internal"', async () => {
    const res = await app.request('/raw');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal');
    // We do NOT leak the original message in the response.
    expect(body.error.message).not.toContain('boom');
  });

  it('serializes a NotFoundError as 404', async () => {
    const res = await app.request('/notfound');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('note');
  });
});
