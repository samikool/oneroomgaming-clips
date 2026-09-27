/**
 * The service worker's routing, as pure functions. `public/sw.js` has no
 * bundler and can't import this, so it repeats the same two decisions in
 * plain JS; this module is the tested source of truth. Keep them in step.
 */

export type SwDecision = "network-with-offline-fallback" | "passthrough";

/**
 * Only same-origin GET navigations are handled. Everything else — API calls,
 * media, the socket, the manifest, another origin such as Authentik — is
 * never intercepted at all.
 */
export function swDecision(req: { mode: string; method: string; url: string }, origin: string): SwDecision {
  let sameOrigin: boolean;

  try {
    sameOrigin = new URL(req.url).origin === origin;
  } catch {
    sameOrigin = false;
  }

  return req.mode === "navigate" && req.method === "GET" && sameOrigin ? "network-with-offline-fallback" : "passthrough";
}

/**
 * Whether a handled navigation gets the offline page. Only when the network
 * couldn't be reached at all. Any response is the answer, passed through as
 * it is: a page, a 500, a 401, and the redirect to the Authentik login.
 */
export function isOfflineFallback(outcome: { ok: true; status: number; type: string } | { ok: false }): boolean {
  return !outcome.ok;
}
