// W-023 mentions inbox at /inbox. SSR-loaded so the unread count
// renders immediately without a client roundtrip.

import { listMentions, type MentionDto } from '$lib/api/mentions';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const mentions: MentionDto[] = await listMentions({ fetch });
  return { mentions };
};
