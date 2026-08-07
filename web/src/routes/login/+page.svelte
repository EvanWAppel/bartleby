<script lang="ts">
  // W-002 sign-in page. Single button -> /auth/google/start, which
  // sets the OAuth state cookie and redirects to Google.

  interface Props {
    data: { next: string; devSignIn: boolean; devEmail: string };
  }
  let { data }: Props = $props();

  // Encode the post-login destination so the server can bounce there.
  // The server-side flow handles the redirect after callback; for now
  // the link just sends users to Google's consent screen.
  let startUrl = $derived(`/auth/google/start?next=${encodeURIComponent(data.next)}`);

  // Dev-only sign-in (see +page.server.ts). POSTs to the same
  // /auth/dev/sign-in endpoint the console shortcut hits; the Set-Cookie
  // lands on this origin via the Vite proxy, then we navigate to `next`.
  // Seed the form field from load data once; it's user-editable after.
  // svelte-ignore state_referenced_locally
  let devEmail = $state(data.devEmail);
  let devError = $state('');
  let devBusy = $state(false);

  async function devSignInSubmit(event: SubmitEvent) {
    event.preventDefault();
    devError = '';
    devBusy = true;
    try {
      const res = await fetch('/auth/dev/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: devEmail, displayName: devEmail.split('@')[0] }),
      });
      if (res.ok) {
        window.location.href = data.next;
        return;
      }
      devError = `Sign-in failed: ${res.status} ${await res.text()}`;
    } catch (err) {
      devError = `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      devBusy = false;
    }
  }
</script>

<div class="login" data-testid="login">
  <h1>Bartleby</h1>
  <p class="sub">Shared notes for a small group.</p>

  <a class="signin" data-testid="signin-link" href={startUrl}>
    <span class="g">G</span>
    Sign in with Google
  </a>

  <p class="note">Access is restricted to people on the allowlist set by the operator.</p>

  {#if data.devSignIn}
    <form class="dev" data-testid="dev-signin" onsubmit={devSignInSubmit}>
      <p class="dev-label">Dev sign-in (local only — <code>ALLOW_TEST_SIGN_IN</code>)</p>
      <div class="dev-row">
        <input
          type="email"
          data-testid="dev-signin-email"
          bind:value={devEmail}
          placeholder="you@example.com"
          aria-label="Dev sign-in email"
          required
        />
        <button type="submit" data-testid="dev-signin-button" disabled={devBusy}>
          {devBusy ? 'Signing in…' : 'Dev sign in'}
        </button>
      </div>
      {#if devError}
        <p class="dev-error" role="alert">{devError}</p>
      {/if}
    </form>
  {/if}
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

  /* Q-005: WCAG AA — #888 on #fff is 3.54:1. #6f6f6f hits 4.55:1. */
  .note {
    margin-top: 2rem;
    font-size: 0.85rem;
    color: #6f6f6f;
    max-width: 24rem;
    text-align: center;
  }

  .dev {
    margin-top: 2rem;
    padding: 1rem 1.2rem;
    border: 1px dashed #c9a227;
    border-radius: 8px;
    background: #fffdf5;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-width: 24rem;
    width: 100%;
  }

  .dev-label {
    margin: 0;
    font-size: 0.8rem;
    color: #6f6f6f;
    text-align: center;
  }

  .dev-label code {
    font-size: 0.75rem;
  }

  .dev-row {
    display: flex;
    gap: 0.5rem;
  }

  .dev-row input {
    flex: 1;
    padding: 0.5rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9rem;
  }

  .dev-row button {
    padding: 0.5rem 0.9rem;
    border: 1px solid #c9a227;
    border-radius: 6px;
    background: #f6e6a8;
    color: #4a3a00;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .dev-row button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .dev-error {
    margin: 0;
    font-size: 0.8rem;
    color: #b00020;
  }
</style>
