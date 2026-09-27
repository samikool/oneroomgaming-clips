import { getDb } from "@/db/client";
import { handleInternalEvent } from "@/lib/social/internal-events";

export const dynamic = "force-dynamic";

/**
 * Theater events from the realtime process, which holds no database. Signed
 * with EMIT_SECRET, the same secret web uses for /emit. Realtime calls this
 * container-to-container, not through Caddy/Authentik, so the secret is the
 * only gate — there is no requireUser here on purpose.
 */
export async function POST(request: Request): Promise<Response> {
  return handleInternalEvent(request, { db: getDb(), secret: process.env.EMIT_SECRET });
}
