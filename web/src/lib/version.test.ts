import { describe, it, expect } from 'vitest';
import { APP_NAME } from './version.js';

describe('web bootstrap', () => {
  it('exposes an app identity (toolchain smoke test)', () => {
    expect(APP_NAME).toBe('bartleby-web');
  });
});
