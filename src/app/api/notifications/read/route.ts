import { getDb } from "@/db/client";
import { markRead, unreadCount } from "@/db/notifications";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_IDS = 200;

/** Marks the given notifications read. Only your own; anything else is ignored. */
export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string")) {
    return new Response(null, { status: 400 });
  }

  const db = getDb();
  markRead(db, user.id, ids as string[]);
  return Response.json({ unread: unreadCount(db, user.id) });
}
