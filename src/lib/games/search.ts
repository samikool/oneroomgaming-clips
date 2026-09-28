import { asc, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games } from "@/db/schema";
import type { Igdb, IgdbGame } from "@/lib/igdb";

export type LocalGame = { id: string; name: string; slug: string; coverPath: string | null };
export type PickerResults = { local: LocalGame[]; igdb: IgdbGame[] };

const MIN_QUERY = 2;

export async function searchGamesForPicker(db: Db, igdb: Igdb | null, q: string): Promise<PickerResults> {
  const text = q.trim();
  if (text.length < MIN_QUERY) {
    return { local: [], igdb: [] };
  }

  const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const local = db
    .select({ id: games.id, name: games.name, slug: games.slug, coverPath: games.coverPath, igdbId: games.igdbId })
    .from(games)
    .where(sql`lower(${games.name}) LIKE ${pattern} ESCAPE '\\'`)
    .orderBy(asc(games.name))
    .limit(8)
    .all();

  let remote: IgdbGame[] = [];
  if (igdb) {
    try {
      remote = await igdb.search(text);
    } catch (error) {
      console.error("igdb: search failed", error);
    }
  }

  const linked = new Set(local.map((g) => g.igdbId).filter((id): id is number => id !== null));
  return {
    local: local.map(({ igdbId: _, ...game }) => game),
    igdb: remote.filter((g) => !linked.has(g.igdbId)),
  };
}
