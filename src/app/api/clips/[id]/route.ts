import { getClip } from "@/db/clips";
import { getDb } from "@/db/client";
import { resolveIdentity } from "@/lib/session";
import { MissingAuthHeadersError } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { resolveIdentity(req.headers); } catch (err) {
    if (!(err instanceof MissingAuthHeadersError)) throw err;
    return new Response("Sign in to view clips.", { status: 401 });
  }
  const clip = getClip(getDb(), (await params).id);
  if (!clip) return new Response("Clip not found", { status: 404 });
  return Response.json({ id: clip.id, title: clip.title, status: clip.status }, {
    headers: { "Cache-Control": "no-store" },
  });
}
