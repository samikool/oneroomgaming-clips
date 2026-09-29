import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deleteGame, mergeGames, type DeleteResult } from "@/db/admin/games-tags";
import { gameCoverPath, linkGameRecord, resolveIgdbGame, setGameCover, type LinkOutcome } from "@/db/games";
import { clips, games } from "@/db/schema";
import { reindexClip } from "@/db/search";
import type { Igdb, IgdbGame } from "@/lib/igdb";
import { removeCoverFile } from "@/lib/media/cleanup";
import { coverFilename, coversDir } from "@/lib/media/paths";

type Env = Partial<NodeJS.ProcessEnv>;
type Failure = { ok: false; error: string };

/**
 * Rows first, files second (as in clip removal): a failed unlink orphans
 * bytes, never leaves a row pointing at a missing cover.
 */
async function finish(db: Db, env: Env, igdb: Igdb, outcome: LinkOutcome, entry: IgdbGame): Promise<void> {
  for (const stale of outcome.staleCovers) {
    removeCoverFile(env, stale);
  }
  if (!entry.coverImageId) {
    // The entry has no art: whatever cover the game had belongs to another entry.
    removeCoverFile(env, setGameCover(db, outcome.gameId, null));
    return;
  }
  const wanted = coverFilename(outcome.gameId, entry.coverImageId);
  if (gameCoverPath(db, outcome.gameId) === wanted) {
    return;
  }
  try {
    await igdb.downloadCover(entry.coverImageId, join(coversDir(env), wanted));
  } catch (error) {
    console.error(`igdb: cover download failed for ${entry.name}`, error);
    return;
  }
  const previous = setGameCover(db, outcome.gameId, wanted);
  if (previous !== wanted) {
    removeCoverFile(env, previous);
  }
}

async function fetchEntry(igdb: Igdb, igdbId: number): Promise<IgdbGame | Failure> {
  try {
    return (await igdb.getGame(igdbId)) ?? { ok: false, error: "IGDB has no such game." };
  } catch (error) {
    console.error("igdb: lookup failed", error);
    return { ok: false, error: "IGDB didn't answer. Try again." };
  }
}

export async function linkGameToIgdb(
  db: Db, env: Env, igdb: Igdb, gameId: string, igdbId: number,
): Promise<{ ok: true; gameId: string } | Failure> {
  const entry = await fetchEntry(igdb, igdbId);
  if ("ok" in entry) {
    return entry;
  }
  let outcome: LinkOutcome;
  try {
    outcome = linkGameRecord(db, gameId, { igdbId: entry.igdbId, name: entry.name, year: entry.year });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Link failed." };
  }
  await finish(db, env, igdb, outcome, entry);
  return { ok: true, gameId: outcome.gameId };
}

export async function pickIgdbGameForClip(
  db: Db, env: Env, igdb: Igdb, clipId: string, igdbId: number,
): Promise<{ ok: true; name: string } | Failure> {
  const entry = await fetchEntry(igdb, igdbId);
  if ("ok" in entry) {
    return entry;
  }
  const outcome = resolveIgdbGame(db, { igdbId: entry.igdbId, name: entry.name, year: entry.year });
  db.update(clips).set({ gameId: outcome.gameId }).where(eq(clips.id, clipId)).run();
  reindexClip(db, clipId);
  await finish(db, env, igdb, outcome, entry);
  const name = db.select({ name: games.name }).from(games).where(eq(games.id, outcome.gameId)).get()!.name;
  return { ok: true, name };
}

/** The local game for an IGDB entry, linked and with its cover. Null when IGDB can't answer. */
export async function ensureIgdbGame(db: Db, env: Env, igdb: Igdb, igdbId: number): Promise<string | null> {
  const entry = await fetchEntry(igdb, igdbId);
  if ("ok" in entry) return null;
  const outcome = resolveIgdbGame(db, { igdbId: entry.igdbId, name: entry.name, year: entry.year });
  await finish(db, env, igdb, outcome, entry);
  return outcome.gameId;
}

export function mergeGamesWithCovers(db: Db, env: Env, fromId: string, intoId: string): number {
  const cover = gameCoverPath(db, fromId);
  const moved = mergeGames(db, fromId, intoId);
  removeCoverFile(env, cover);
  return moved;
}

export function deleteGameWithCover(db: Db, env: Env, id: string, opts: { force: boolean }): DeleteResult {
  const cover = gameCoverPath(db, id);
  const result = deleteGame(db, id, opts);
  if (result.ok) {
    removeCoverFile(env, cover);
  }
  return result;
}
