<script lang="ts">
  // Phase 1 X-004: invites mobile users to open the same URL on desktop.
  // mailto: href is built lazily in the browser since SSR doesn't know the
  // current URL. We assemble it on mount and keep it reactive to client
  // navigation.

  import { onMount } from 'svelte';

  let mailtoHref: string = $state('mailto:');

  onMount(() => {
    const buildHref = () => {
      const subject = encodeURIComponent('Bartleby note');
      const body = encodeURIComponent(`Open on desktop: ${window.location.href}`);
      mailtoHref = `mailto:?subject=${subject}&body=${body}`;
    };

    buildHref();
    window.addEventListener('popstate', buildHref);
    return () => window.removeEventListener('popstate', buildHref);
  });
</script>

<aside class="banner" data-testid="desktop-banner">
  <p>
    Bartleby is read-only on phones.
    <a href={mailtoHref} data-testid="desktop-banner-link">Email this link to yourself</a>
    to open it on desktop.
  </p>
</aside>

<style>
  .banner {
    position: sticky;
    bottom: 0;
    margin: 0;
    padding: 0.75rem 1rem;
    background: #fffbe6;
    border-top: 1px solid #f0d36b;
    font-family: system-ui, sans-serif;
    font-size: 0.9rem;
    color: #5a4900;
  }

  .banner p {
    margin: 0;
  }

  .banner a {
    color: #4a3e00;
    text-decoration: underline;
  }
</style>
