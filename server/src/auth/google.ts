// Google OAuth 2.0 client for A-002.
//
// Defined as an interface so vitest can inject a stub. The HTTPS-backed
// production client lives at the bottom of this file.

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleUserInfo {
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface GoogleClient {
  buildAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<{ accessToken: string }>;
  fetchUserInfo(accessToken: string): Promise<GoogleUserInfo>;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleConfigError';
  }
}

export function loadGoogleConfig(env: Record<string, string | undefined>): GoogleConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (clientId === undefined || clientId.length === 0) {
    throw new GoogleConfigError('GOOGLE_CLIENT_ID is required.');
  }
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new GoogleConfigError('GOOGLE_CLIENT_SECRET is required.');
  }
  return { clientId, clientSecret };
}

export function createGoogleClient(
  cfg: GoogleConfig,
  fetchImpl: typeof fetch = fetch,
): GoogleClient {
  return {
    buildAuthorizeUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
      });
      return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode({ code, redirectUri }) {
      const body = new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      const res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google token exchange failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { access_token?: string };
      if (typeof json.access_token !== 'string') {
        throw new Error('Google token response missing access_token');
      }
      return { accessToken: json.access_token };
    },

    async fetchUserInfo(accessToken) {
      const res = await fetchImpl(GOOGLE_USERINFO_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google userinfo failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as {
        email?: string;
        name?: string;
        email_verified?: boolean;
      };
      if (typeof json.email !== 'string') {
        throw new Error('Google userinfo missing email');
      }
      return {
        email: json.email,
        displayName: typeof json.name === 'string' && json.name.length > 0 ? json.name : json.email,
        emailVerified: json.email_verified === true,
      };
    },
  };
}
