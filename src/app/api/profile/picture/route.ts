import { getDb } from "@/db/client";
import { publish } from "@/lib/realtime/publish";
import { PictureRejectedError, removePicture, savePicture } from "@/lib/profiles/picture-store";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The username comes from the Authentik identity, never from the body. */
export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Missing picture." }, { status: 400 });
  }

  const s256 = form.get("s256");
  const s64 = form.get("s64");

  if (!(s256 instanceof Blob) || !(s64 instanceof Blob)) {
    return Response.json({ error: "Missing picture." }, { status: 400 });
  }

  try {
    const profile = await savePicture(getDb(), user.authentikUsername, {
      s256: new Uint8Array(await s256.arrayBuffer()),
      s64: new Uint8Array(await s64.arrayBuffer()),
    });
    await publish({ t: "profile.updated", profile });
    return Response.json({ profile });
  } catch (error) {
    if (error instanceof PictureRejectedError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(): Promise<Response> {
  const user = await requireUser();
  const profile = await removePicture(getDb(), user.authentikUsername);
  await publish({ t: "profile.updated", profile });
  return Response.json({ profile });
}
