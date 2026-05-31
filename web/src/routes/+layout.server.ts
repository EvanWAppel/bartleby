// Passes locals.user (set by hooks.server.ts) into the layout so the
// shell can render the signed-in user's name + color.

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return { user: locals.user };
};
