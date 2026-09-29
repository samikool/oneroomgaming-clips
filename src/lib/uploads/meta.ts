import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, users } from "@/db/schema";
import { ensureIgdbGame } from "@/lib/games/link";
import type { Igdb } from "@/lib/igdb";
import { plausibleRecordedAt } from "@/lib/media/recorded";

/**
 * The review list's choices, checked before any bytes move. Only what passes
 * comes back, and it replaces what the browser sent. A bad value is dropped,
 * never a reason to refuse the upload; IGDB trouble means no game.
 */
const CAP = 20;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const list = (raw: string | null | undefined) =>
  [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];

export async function resolveUploadMeta(
  db: Db,
  env: Partial<NodeJS.ProcessEnv>,
  igdb: Igdb | null,
  raw: Record<string, string | null | undefined>,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const tags = list(raw.tags?.toLowerCase()).filter((t) => t.length <= 64 && !/[\x00-\x1f\x7f]/.test(t)).slice(0, CAP);
  if (tags.length) out.tags = tags.join(",");

  // Typed by hand in the list, so "Ben" means ben.
  const wanted = list(raw.people?.toLowerCase()).slice(0, CAP);
  if (wanted.length) {
    const known = db
      .select({ u: users.authentikUsername })
      .from(users)
      .where(inArray(sql`lower(${users.authentikUsername})`, wanted))
      .all();
    if (known.length) out.people = known.map((k) => k.u).sort().join(",");
  }

  const at = Number(raw.recordedAt);
  if (/^\d{1,15}$/.test(raw.recordedAt ?? "") && plausibleRecordedAt(at, now)) out.recordedAt = String(at);

  const game = raw.game?.trim() ?? "";
  const local = game.match(/^local:(.+)$/);
  const remote = game.match(/^igdb:(\d{1,10})$/);
  const text = game.match(/^text:(.+)$/);
  if (local && ULID.test(local[1]) && db.select({ id: games.id }).from(games).where(eq(games.id, local[1])).get()) {
    out.gameId = local[1];
  } else if (remote) {
    // A folder of 40 clips asks IGDB once: after the first, the game is local.
    const linked = db.select({ id: games.id }).from(games).where(eq(games.igdbId, Number(remote[1]))).get();
    const id = linked?.id ?? (igdb ? await ensureIgdbGame(db, env, igdb, Number(remote[1])) : null);
    if (id) out.gameId = id;
  } else if (text) {
    const name = text[1].trim();
    if (name.length > 0 && name.length <= 64 && !/[\x00-\x1f\x7f]/.test(name)) out.gameName = name;
  }

  return out;
}
