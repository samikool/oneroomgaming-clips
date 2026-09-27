import type { ReportedEvent } from "@/lib/realtime/envelope";

const TIMEOUT_MS = 2000;

/**
 * Tells web about theater events it can't see: plays, reactions, chat that
 * mentions someone. Fire-and-forget by construction — the caller gets
 * nothing to await, so a slow or dead web process can never stall a socket.
 *
 * Signed with EMIT_SECRET, the same secret web uses for /emit, in reverse.
 */
export function createReporter({
  url,
  secret,
  fetchImpl = fetch,
  log = console.warn,
}: {
  url: string | undefined;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
  log?: (...args: unknown[]) => void;
}): (event: ReportedEvent) => void {
  if (!url || !secret) {
    log("realtime: REALTIME_EVENTS_URL or EMIT_SECRET unset — theater activity will not be recorded");
    return () => {};
  }

  let warned = false;
  const fail = (event: ReportedEvent, error: unknown) => {
    if (!warned) {
      warned = true;
      log(`realtime: event report failed (${event.kind})`, error);
    }
  };

  return (event) => {
    try {
      void fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Emit-Secret": secret },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch((error: unknown) => fail(event, error));
    } catch (error) {
      // A fetch that throws synchronously must not reach the socket handler either.
      fail(event, error);
    }
  };
}
