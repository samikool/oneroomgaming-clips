import { getDb } from "@/db/client";
import { recordView } from "@/db/activity";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The clip page reports a view after 3s of real playback. Deduped per 30 minutes. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  recordView(getDb(), user.id, id);
  return new Response(null, { status: 204 });
}
