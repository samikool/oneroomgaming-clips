import { getDb } from "@/db/client";
import { listNotifications, unreadCount } from "@/db/notifications";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A page of your notifications, newest first; `before` is the last item's `updatedAt`. */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  const raw = new URL(request.url).searchParams.get("before");
  const before = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const db = getDb();

  return Response.json({
    items: listNotifications(db, user.id, { before }),
    unread: unreadCount(db, user.id),
  });
}
