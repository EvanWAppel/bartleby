// Create a note via the bartleby /notes API as the signed-in context.
// Returns the new id so tests can navigate / assert.

import type { BrowserContext } from '@playwright/test';

export interface CreatedNote {
  id: string;
  title: string;
}

export async function createNote(context: BrowserContext, title?: string): Promise<CreatedNote> {
  const res = await context.request.post('/notes', {
    data: title === undefined ? {} : { title },
  });
  if (!res.ok()) {
    throw new Error(`createNote failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as CreatedNote;
}
