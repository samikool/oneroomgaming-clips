import { getDb } from "@/db/client";
import { collectionsForClip } from "@/db/collections";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The collections the caller can put this clip in, flagged when they already hold it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  return Response.json({ me: user.authentikUsername, collections: collectionsForClip(getDb(), id, user.id) });
}
