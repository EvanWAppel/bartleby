import { describe, it, expect } from 'vitest';
import { placeholder } from './index.js';

describe('server bootstrap', () => {
  it('exposes a placeholder identity (toolchain smoke test)', () => {
    expect(placeholder()).toBe('bartleby-server');
  });
});
