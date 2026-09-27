import type { Db } from "@/db/client";
import { isAuthorizedEmit } from "@/lib/realtime/emit-auth";
import { onTheaterEvent } from "./events";
import { parseReportedEvent } from "./report-parse";

/**
 * The body of POST /api/internal/events, apart from the route so it can be
 * tested without a request context. 401 on a bad signature, 400 on a bad
 * body, 204 otherwise — including an unknown clip or user, which is dropped:
 * realtime has nothing to retry.
 */
export async function handleInternalEvent(
  request: Request,
  { db, secret }: { db: Db; secret: string | undefined },
): Promise<Response> {
  if (!isAuthorizedEmit(request.headers.get("x-emit-secret") ?? undefined, secret)) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = parseReportedEvent(body);
  if (!event) return new Response(null, { status: 400 });

  await onTheaterEvent(db, event);
  return new Response(null, { status: 204 });
}
