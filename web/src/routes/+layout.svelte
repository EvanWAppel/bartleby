<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  interface Props {
    data: { user?: { display_name: string; color: string } };
    children: Snippet;
  }

  let { data, children }: Props = $props();

  // /login and /auth/* render bare (no shell). All other routes are
  // gated by hooks.server.ts so user is always defined here.
  let pathname = $derived(page.url.pathname);
  let bare = $derived(pathname === '/login' || pathname.startsWith('/auth/'));
</script>

<!-- Q-005: every route needs a non-empty <title> (WCAG 2.4.2 / axe
     document-title). Individual routes can still override via their
     own <svelte:head><title> — SvelteKit merges per-route titles on
     top of this default. -->
<svelte:head>
  <title>Bartleby</title>
</svelte:head>

{#if bare}
  {@render children()}
{:else}
  <AppShell user={data.user ?? null}>
    {@render children()}
  </AppShell>
{/if}
