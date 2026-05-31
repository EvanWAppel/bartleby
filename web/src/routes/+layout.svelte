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

{#if bare}
  {@render children()}
{:else}
  <AppShell user={data.user ?? null}>
    {@render children()}
  </AppShell>
{/if}
