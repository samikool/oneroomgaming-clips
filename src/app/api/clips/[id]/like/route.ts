import { getDb } from "@/db/client";
import { onLike, onUnlike } from "@/lib/social/events";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Like a clip. Idempotent; refused on your own clip. */
export async function POST(_request: Request, { params }: Context): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  const { status, count } = await onLike(getDb(), user.id, id);

  if (status === "own") return Response.json({ error: "can't like your own clip" }, { status: 403 });
  if (status === "missing") return Response.json({ error: "no such clip" }, { status: 404 });
  return Response.json({ count, liked: true });
}

/** Unlike a clip. Unliking what you never liked does nothing. */
export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  const { count } = await onUnlike(getDb(), user.id, id);
  return Response.json({ count, liked: false });
}
