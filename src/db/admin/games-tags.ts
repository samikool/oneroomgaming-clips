import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { slugify } from "@/db/metadata";
import { clips, clipTags, games, tags } from "@/db/schema";
import { reindexClip } from "@/db/search";

/**
 * The admin's vocabulary tools: rename, merge and delete for games and tags.
 *
 * Every write is one transaction that ends by reindexing the clips it
 * touched, so search never finds a clip by a name that no longer exists.
 * Authorization is not here; it belongs at the action boundary.
 */

export type RenameResult = { ok: true } | { ok: false; error: string };
export type DeleteResult = { ok: true; detached: number } | { ok: false; inUse: number };

const NAME_MAX = 64;

export class SelfMergeError extends Error {
  constructor() {
    super("Can't merge something into itself.");
    this.name = "SelfMergeError";
  }
}

export function listGamesWithCounts(db: Db): { id: string; name: string; slug: string; clips: number }[] {
  return db
    .select({ id: games.id, name: games.name, slug: games.slug, clips: count(clips.id) })
    .from(games)
    .leftJoin(clips, eq(clips.gameId, games.id))
    .groupBy(games.id)
    .orderBy(asc(games.name))
    .all();
}

export function listTagsWithCounts(db: Db): { id: string; name: string; clips: number }[] {
  return db
    .select({ id: tags.id, name: tags.name, clips: count(clipTags.clipId) })
    .from(tags)
    .leftJoin(clipTags, eq(clipTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name))
    .all();
}

function gameClipIds(db: Db, gameId: string): string[] {
  return db.select({ id: clips.id }).from(clips).where(eq(clips.gameId, gameId)).all().map((r) => r.id);
}

function tagClipIds(db: Db, tagId: string): string[] {
  return db.select({ id: clipTags.clipId }).from(clipTags).where(eq(clipTags.tagId, tagId)).all().map((r) => r.id);
}

function reindexAllOf(db: Db, clipIds: string[]): void {
  for (const id of clipIds) {
    reindexClip(db, id);
  }
}

function checkName(name: string): string | { error: string } {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { error: "A name can't be empty." };
  }

  if (trimmed.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { error: `Names are at most ${NAME_MAX} plain characters.` };
  }

  return trimmed;
}

/**
 * A new name and, with it, a new slug. Two games may not share a slug, so a
 * name that slugifies onto another game is refused with a message — the
 * admin wants a merge there, not a 500. Old `?game=` links stop matching.
 */
export function renameGame(db: Db, id: string, name: string): RenameResult {
  const checked = checkName(name);

  if (typeof checked !== "string") {
    return { ok: false, ...checked };
  }

  const slug = slugify(checked);

  if (slug.length === 0) {
    return { ok: false, error: "That name has no letters or numbers in it." };
  }

  const clash = db.select({ id: games.id }).from(games).where(eq(games.slug, slug)).get();

  if (clash && clash.id !== id) {
    return { ok: false, error: "A game with that name already exists — merge instead." };
  }

  db.transaction(() => {
    db.update(games).set({ name: checked, slug }).where(eq(games.id, id)).run();
    reindexAllOf(db, gameClipIds(db, id));
  });

  return { ok: true };
}

/** Tags are lowercase everywhere (see `setClipTags`), and so are their renames. */
export function renameTag(db: Db, id: string, name: string): RenameResult {
  const checked = checkName(name);

  if (typeof checked !== "string") {
    return { ok: false, ...checked };
  }

  const lower = checked.toLowerCase();
  const clash = db.select({ id: tags.id }).from(tags).where(eq(tags.name, lower)).get();

  if (clash && clash.id !== id) {
    return { ok: false, error: "A tag with that name already exists — merge instead." };
  }

  db.transaction(() => {
    db.update(tags).set({ name: lower }).where(eq(tags.id, id)).run();
    reindexAllOf(db, tagClipIds(db, id));
  });

  return { ok: true };
}

/** Moves every clip from one game to another and deletes the first. Returns clips moved. */
export function mergeGames(db: Db, fromId: string, intoId: string): number {
  if (fromId === intoId) {
    throw new SelfMergeError();
  }

  return db.transaction(() => {
    if (!db.select({ id: games.id }).from(games).where(eq(games.id, intoId)).get()) {
      throw new Error("The game to merge into is gone.");
    }

    const moved = gameClipIds(db, fromId);
    db.update(clips).set({ gameId: intoId }).where(eq(clips.gameId, fromId)).run();
    db.delete(games).where(eq(games.id, fromId)).run();
    reindexAllOf(db, moved);
    return moved.length;
  });
}

/**
 * Moves every clip from one tag to another and deletes the first. A clip that
 * already carries both ends with one row: the union, never a duplicate
 * `clip_tags` primary key. Returns the clips that carried the source tag.
 */
export function mergeTags(db: Db, fromId: string, intoId: string): number {
  if (fromId === intoId) {
    throw new SelfMergeError();
  }

  return db.transaction(() => {
    if (!db.select({ id: tags.id }).from(tags).where(eq(tags.id, intoId)).get()) {
      throw new Error("The tag to merge into is gone.");
    }

    const affected = tagClipIds(db, fromId);
    db.run(sql`INSERT OR IGNORE INTO clip_tags (clip_id, tag_id)
               SELECT clip_id, ${intoId} FROM clip_tags WHERE tag_id = ${fromId}`);
    db.delete(clipTags).where(eq(clipTags.tagId, fromId)).run();
    db.delete(tags).where(eq(tags.id, fromId)).run();
    reindexAllOf(db, affected);
    return affected.length;
  });
}

/** Unused: deleted. In use: refused with the count, unless forced, which detaches first. */
export function deleteGame(db: Db, id: string, { force }: { force: boolean }): DeleteResult {
  return db.transaction(() => {
    const used = gameClipIds(db, id);

    if (used.length > 0 && !force) {
      return { ok: false, inUse: used.length } as const;
    }

    db.update(clips).set({ gameId: null }).where(eq(clips.gameId, id)).run();
    db.delete(games).where(eq(games.id, id)).run();
    reindexAllOf(db, used);
    return { ok: true, detached: used.length } as const;
  });
}

export function deleteTag(db: Db, id: string, { force }: { force: boolean }): DeleteResult {
  return db.transaction(() => {
    const used = tagClipIds(db, id);

    if (used.length > 0 && !force) {
      return { ok: false, inUse: used.length } as const;
    }

    db.delete(clipTags).where(eq(clipTags.tagId, id)).run();
    db.delete(tags).where(eq(tags.id, id)).run();
    reindexAllOf(db, used);
    return { ok: true, detached: used.length } as const;
  });
}
