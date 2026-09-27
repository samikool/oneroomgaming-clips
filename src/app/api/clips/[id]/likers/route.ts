import { getDb } from "@/db/client";
import { likers } from "@/db/likes";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Who liked a clip, newest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireUser();
  const { id } = await params;
  return Response.json({ likers: likers(getDb(), id) });
}
