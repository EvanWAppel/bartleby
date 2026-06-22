import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Bartleby's API (auth + notes + search + users + comments) runs as a
// separate Node process on its own port. In dev + tests we proxy those
// route prefixes through the SvelteKit dev server so the browser sees a
// single origin and we don't have to deal with cookies / CORS.
//
// Production (adapter-node behind Caddy) handles the same split at the
// reverse proxy layer.
const bartlebyHttpPort = process.env.BARTLEBY_HTTP_PORT ?? '3000';
const bartlebyTarget = `http://127.0.0.1:${bartlebyHttpPort}`;
const proxiedPrefixes = ['/auth', '/notes', '/search', '/users', '/comments', '/mentions'];

const proxy = Object.fromEntries(
  proxiedPrefixes.map((prefix) => [prefix, { target: bartlebyTarget, changeOrigin: false }]),
);

export default defineConfig({
  plugins: [sveltekit()],
  server: { proxy },
  preview: { proxy },
});
