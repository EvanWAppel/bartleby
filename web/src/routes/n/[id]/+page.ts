// Pass the [id] route param down to the editor as the Yjs room name.

import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  return { id: params.id };
};
