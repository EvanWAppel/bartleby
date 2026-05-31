<script lang="ts">
  // W-002 sign-in page. Single button -> /auth/google/start, which
  // sets the OAuth state cookie and redirects to Google.

  interface Props {
    data: { next: string };
  }
  let { data }: Props = $props();

  // Encode the post-login destination so the server can bounce there.
  // The server-side flow handles the redirect after callback; for now
  // the link just sends users to Google's consent screen.
  let startUrl = $derived(`/auth/google/start?next=${encodeURIComponent(data.next)}`);
</script>

<div class="login" data-testid="login">
  <h1>Bartleby</h1>
  <p class="sub">Shared notes for a small group.</p>

  <a class="signin" data-testid="signin-link" href={startUrl}>
    <span class="g">G</span>
    Sign in with Google
  </a>

  <p class="note">Access is restricted to people on the allowlist set by the operator.</p>
</div>

<style>
  .login {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    padding: 1.5rem;
  }

  .login h1 {
    margin: 0;
    font-size: 2rem;
  }

  .sub {
    color: #666;
    margin: 0.5rem 0 2rem;
  }

  .signin {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.7rem 1.2rem;
    background: #fff;
    color: #222;
    border: 1px solid #ccc;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    transition: background 80ms ease;
  }

  .signin:hover {
    background: #f5f5f5;
  }

  .signin .g {
    display: inline-flex;
    width: 1.3rem;
    height: 1.3rem;
    align-items: center;
    justify-content: center;
    background: #4285f4;
    color: #fff;
    border-radius: 50%;
    font-weight: 700;
    font-family: serif;
  }

  .note {
    margin-top: 2rem;
    font-size: 0.85rem;
    color: #888;
    max-width: 24rem;
    text-align: center;
  }
</style>
