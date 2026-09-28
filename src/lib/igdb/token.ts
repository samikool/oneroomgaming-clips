/**
 * Twitch client-credentials token for IGDB. Tokens last ~60 days; one is held
 * in memory and replaced a minute before expiry, or when IGDB rejects it.
 */
export type TokenSource = { get(): Promise<string>; invalidate(): void };

const MARGIN_MS = 60_000;

export function createTokenSource(
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch,
  now: () => number,
  timeoutMs = 3000,
): TokenSource {
  let held: { token: string; expiresAt: number } | null = null;

  return {
    async get() {
      if (held && now() < held.expiresAt - MARGIN_MS) {
        return held.token;
      }
      const url = new URL("https://id.twitch.tv/oauth2/token");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("client_secret", clientSecret);
      url.searchParams.set("grant_type", "client_credentials");
      const response = await fetchFn(url.toString(), { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new Error(`IGDB token request failed: ${response.status}`);
      }
      const body = (await response.json()) as { access_token: string; expires_in: number };
      held = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 };
      return held.token;
    },
    invalidate() {
      held = null;
    },
  };
}
