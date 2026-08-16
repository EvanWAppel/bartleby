import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ProxyOptions } from 'vite';

// Bartleby's API (auth + notes + search + users + comments) runs as a
// separate Node process on its own port. In dev + tests we proxy those
// route prefixes through the SvelteKit dev server so the browser sees a
// single origin and we don't have to deal with cookies / CORS.
//
// Production (adapter-node behind Caddy) handles the same split at the
// reverse proxy layer.
const bartlebyHttpPort = process.env.BARTLEBY_HTTP_PORT ?? '3000';
const bartlebyTarget = `http://127.0.0.1:${bartlebyHttpPort}`;
const proxiedPrefixes = [
  '/auth',
  '/notes',
  '/search',
  '/users',
  '/comments',
  '/mentions',
  '/export',
  // Q-003: test-only admin routes (only mounted on the bartleby server
  // when ALLOW_TEST_SIGN_IN=true). Proxied here so Playwright can hit
  // them through the SvelteKit dev server.
  '/admin',
];

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  proxiedPrefixes.map((prefix) => [prefix, { target: bartlebyTarget, changeOrigin: false }]),
);

proxy['/collaboration'] = {
  target: `ws://127.0.0.1:${process.env.BARTLEBY_WS_PORT ?? '1234'}`,
  changeOrigin: false,
  ws: true,
};

export default defineConfig({
  plugins: [sveltekit()],
  server: { proxy },
  preview: { proxy },
});
