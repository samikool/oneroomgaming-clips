import type { ServerMessage } from "./envelope";

const TIMEOUT_MS = 2000;

let warned = false;

/**
 * Fire-and-forget a message to the realtime service.
 *
 * This runs on the path of every upload completion and every job transition,
 * so it must never throw and never block for long: if realtime is down or
 * slow, the clip is still created and the job still completes — the user just
 * misses a live update until their next page load. Live updates are a
 * nicety layered on top, never a dependency of the pipeline.
 */
export async function publish(
  message: ServerMessage,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<boolean> {
  const base = env.REALTIME_URL;
  const secret = env.EMIT_SECRET;

  if (!base || !secret) {
    // Warn once, and only when reading the real environment. This message is
    // for an operator who misconfigured a deployment; a caller passing an
    // explicit env without these keys has made a deliberate choice and does
    // not need telling, which also keeps the test suite's output clean.
    if (!warned && env === process.env) {
      warned = true;
      console.warn("realtime: REALTIME_URL or EMIT_SECRET unset — live updates are disabled");
    }

    return false;
  }

  try {
    const response = await fetch(`${base}/emit`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Emit-Secret": secret },
      body: JSON.stringify(message),
      // A hung connection to realtime must not hold a job handler open.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    return response.ok;
  } catch (error) {
    console.warn(`realtime: publish failed (${message.t})`, error);
    return false;
  }
}
