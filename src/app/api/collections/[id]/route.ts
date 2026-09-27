import { getDb } from "@/db/client";
import { getCollection } from "@/db/collections";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One collection with its clips in order, or 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  const collection = getCollection(getDb(), id, user.id);
  return collection ? Response.json({ collection }) : Response.json({ error: "not found" }, { status: 404 });
}
