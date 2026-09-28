import { getDb } from "@/db/client";
import { searchGamesForPicker } from "@/lib/games/search";
import { getIgdb } from "@/lib/igdb";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The game picker: your games, then IGDB's. IGDB trouble degrades to your games only. */
export async function GET(request: Request): Promise<Response> {
  await requireUser();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(await searchGamesForPicker(getDb(), getIgdb(), q));
}
