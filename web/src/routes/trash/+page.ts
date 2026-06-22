// W-022 /trash: list trashed notes via S-003. SSR-loaded so the page
// arrives fully populated and Playwright doesn't have to wait through
// an extra fetch round-trip.

import { listTrashed, type NoteSummary } from '$lib/api/notes';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const notes: NoteSummary[] = await listTrashed({ fetch });
  return { notes };
};
