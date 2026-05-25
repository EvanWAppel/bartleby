# @bartleby/web

SvelteKit web client. ProseMirror WYSIWYG editor with y-prosemirror binding
to the Hocuspocus collab server. Adapter: `@sveltejs/adapter-node` for
straightforward self-host alongside the Node server.

## Quick start

```sh
npm install
npm run dev        # vite dev server on :5173
npm test           # vitest (unit)
npm run test:e2e   # playwright (e2e, auto-starts dev server)
npm run typecheck
npm run lint
```

## Why SvelteKit

PRD §7.4 left framework as TBD. Picked SvelteKit because:

- Tiny runtime, fast dev loop.
- ProseMirror integrates cleanly with any framework; Svelte 5's runes make
  reactive state around the editor simple.
- Adapter-node makes self-hosting trivial.

## First-run Playwright

After `npm install`, also run:

```sh
npx playwright install chromium
```

(only chromium needed for v1.)
