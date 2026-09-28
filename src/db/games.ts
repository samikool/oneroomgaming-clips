import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { mergeGames } from "./admin/games-tags";
import { slugify } from "./metadata";
import { clips, games } from "./schema";
import { reindexClip } from "./search";

/**
 * Linking games to IGDB entries. Pure database: the caller downloads covers
 * and removes `staleCovers` files after this commits.
 */
export type LinkOutcome = { gameId: string; staleCovers: string[] };
export type IgdbEntry = { igdbId: number; name: string; year?: number | null };

function row(db: Db, id: string) {
  return db.select().from(games).where(eq(games.id, id)).get();
}

function slugHolder(db: Db, slug: string) {
  return db.select().from(games).where(eq(games.slug, slug)).get();
}

/**
 * The slug a linked game should take. The official name's slug, unless another
 * *linked* game holds it — a remake such as DOOM (2016) against Doom (1993) —
 * in which case the year, then the IGDB id, tells them apart. An unlinked
 * holder is not a conflict: the caller merges it in.
 */
function slugFor(db: Db, entry: IgdbEntry, selfId: string | null): string {
  const base = slugify(entry.name) || String(entry.igdbId);
  const candidates = [base, `${base}-${entry.year ?? entry.igdbId}`, `${base}-${entry.igdbId}`];
  for (const slug of candidates) {
    const holder = slugHolder(db, slug);
    if (!holder || holder.id === selfId || holder.igdbId === null) {
      return slug;
    }
  }
  return `${base}-${entry.igdbId}`;
}

/** Merge `fromId` into `intoId`, remembering the loser's cover so its file can go. */
function absorb(db: Db, fromId: string, intoId: string, stale: string[]): void {
  const cover = row(db, fromId)?.coverPath;
  if (cover) {
    stale.push(cover);
  }
  mergeGames(db, fromId, intoId);
}

export function linkGameRecord(db: Db, gameId: string, entry: IgdbEntry): LinkOutcome {
  return db.transaction(() => {
    const stale: string[] = [];
    const current = row(db, gameId);
    if (!current) {
      throw new Error("That game is gone.");
    }

    // 1. Another game already has this entry: this one merges into it.
    const linked = db.select().from(games).where(eq(games.igdbId, entry.igdbId)).get();
    if (linked && linked.id !== gameId) {
      absorb(db, gameId, linked.id, stale);
      return { gameId: linked.id, staleCovers: stale };
    }

    // 2. A free-text game holds the slug this one will take: it merges into this one.
    //    A linked holder never does — slugFor steps around it.
    const slug = slugFor(db, entry, gameId);
    const clash = slugHolder(db, slug);
    if (clash && clash.id !== gameId && clash.igdbId === null) {
      absorb(db, clash.id, gameId, stale);
    }

    db.update(games).set({ igdbId: entry.igdbId, name: entry.name, slug }).where(eq(games.id, gameId)).run();
    for (const { id } of db.select({ id: clips.id }).from(clips).where(eq(clips.gameId, gameId)).all()) {
      reindexClip(db, id);
    }
    return { gameId, staleCovers: stale };
  });
}

export function resolveIgdbGame(db: Db, entry: IgdbEntry): LinkOutcome {
  return db.transaction(() => {
    const linked = db.select().from(games).where(eq(games.igdbId, entry.igdbId)).get();
    if (linked) {
      return { gameId: linked.id, staleCovers: [] };
    }
    // A free-text game spelled the same way is this game, not yet linked.
    const sameSlug = slugHolder(db, slugify(entry.name) || String(entry.igdbId));
    if (sameSlug && sameSlug.igdbId === null) {
      return linkGameRecord(db, sameSlug.id, entry);
    }
    const id = ulid();
    db.insert(games).values({ id, name: entry.name, slug: slugFor(db, entry, null), igdbId: entry.igdbId }).run();
    return { gameId: id, staleCovers: [] };
  });
}

export function setGameCover(db: Db, gameId: string, filename: string | null): string | null {
  const previous = gameCoverPath(db, gameId);
  db.update(games).set({ coverPath: filename }).where(eq(games.id, gameId)).run();
  return previous;
}

export function gameCoverPath(db: Db, gameId: string): string | null {
  return row(db, gameId)?.coverPath ?? null;
}
