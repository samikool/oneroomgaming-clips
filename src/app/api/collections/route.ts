import { getDb } from "@/db/client";
import { listCollections } from "@/db/collections";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Every collection, newest updated first: the theater's Collections popover. */
export async function GET(): Promise<Response> {
  await requireUser();
  return Response.json({ collections: listCollections(getDb(), {}) });
}
