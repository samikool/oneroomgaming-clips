import { and, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { BulkChanges } from "@/lib/clips/bulk-changes";
import type { Db } from "./client";
import { slugify } from "./metadata";
import { clipParticipants, clips, clipTags, games, tags, users } from "./schema";
import { reindexClip } from "./search";

/**
 * Bulk edits: add and remove, never replace, all in one transaction so a
 * selection is either all changed or not at all. Authorization is at the
 * action boundary. The game is resolved before this runs (IGDB is async).
 */
export type ResolvedGame = { op: "leave" } | { op: "clear" } | { op: "id"; gameId: string } | { op: "name"; name: string };
export type ResolvedChanges = Omit<BulkChanges, "game"> & { game: ResolvedGame };

function gameIdFor(db: Db, game: ResolvedGame): string | null | undefined {
  if (game.op === "leave") return undefined;
  if (game.op === "clear") return null;
  if (game.op === "id") {
    return db.select({ id: games.id }).from(games).where(eq(games.id, game.gameId)).get() ? game.gameId : undefined;
  }
  const slug = slugify(game.name);
  const existing = db.select({ id: games.id }).from(games).where(eq(games.slug, slug)).get();
  if (existing) return existing.id;
  const id = ulid();
  db.insert(games).values({ id, name: game.name, slug }).run();
  return id;
}

function tagIds(db: Db, names: string[], create: boolean): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const row = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    if (row) ids.push(row.id);
    else if (create) {
      const id = ulid();
      db.insert(tags).values({ id, name }).run();
      ids.push(id);
    }
  }
  return ids;
}

function userIds(db: Db, usernames: string[]): { id: string; username: string }[] {
  if (usernames.length === 0) return [];
  return db
    .select({ id: users.id, username: users.authentikUsername })
    .from(users)
    .where(inArray(sql`lower(${users.authentikUsername})`, usernames))
    .all();
}

export function applyBulkEdit(
  db: Db,
  ids: string[],
  changes: ResolvedChanges,
): { updated: string[]; skipped: number; added: Map<string, string[]>; unknownPeople: string[] } {
  return db.transaction(() => {
    const present =
      ids.length === 0
        ? []
        : db.select({ id: clips.id }).from(clips).where(inArray(clips.id, ids)).all().map((r) => r.id);
    const gameId = gameIdFor(db, changes.game);
    const addTagIds = tagIds(db, changes.addTags, true);
    const removeTagIds = tagIds(db, changes.removeTags, false);
    const addUsers = userIds(db, changes.addPeople);
    const removeUserIds = userIds(db, changes.removePeople).map((u) => u.id);
    const added = new Map<string, string[]>();
    const matched = new Set(addUsers.map((u) => u.username.toLowerCase()));
    const unknownPeople = changes.addPeople.filter((p) => !matched.has(p.toLowerCase()));

    for (const clipId of present) {
      if (gameId !== undefined) db.update(clips).set({ gameId }).where(eq(clips.id, clipId)).run();
      for (const tagId of addTagIds) {
        db.insert(clipTags).values({ clipId, tagId }).onConflictDoNothing().run();
      }
      if (removeTagIds.length) {
        db.delete(clipTags).where(and(eq(clipTags.clipId, clipId), inArray(clipTags.tagId, removeTagIds))).run();
      }
      for (const user of addUsers) {
        const inserted = db
          .insert(clipParticipants)
          .values({ clipId, userId: user.id })
          .onConflictDoNothing()
          .returning({ clipId: clipParticipants.clipId })
          .get();
        if (inserted) added.set(user.username, [...(added.get(user.username) ?? []), clipId]);
      }
      if (removeUserIds.length) {
        db.delete(clipParticipants)
          .where(and(eq(clipParticipants.clipId, clipId), inArray(clipParticipants.userId, removeUserIds)))
          .run();
      }
      reindexClip(db, clipId);
    }

    return { updated: present, skipped: ids.length - present.length, added, unknownPeople };
  });
}

export type SelectionSummary = {
  total: number;
  games: { id: string | null; name: string; count: number }[];
  tags: { name: string; count: number }[];
  people: { username: string; count: number }[];
};

export function selectionSummary(db: Db, ids: string[]): SelectionSummary {
  if (ids.length === 0) return { total: 0, games: [], tags: [], people: [] };
  const rows = db
    .select({ id: clips.id, gameId: clips.gameId, gameName: games.name })
    .from(clips)
    .leftJoin(games, eq(clips.gameId, games.id))
    .where(inArray(clips.id, ids))
    .all();
  const present = rows.map((r) => r.id);
  const gameCounts = new Map<string | null, { id: string | null; name: string; count: number }>();
  for (const r of rows) {
    const key = r.gameId ?? null;
    const entry = gameCounts.get(key) ?? { id: key, name: r.gameName ?? "", count: 0 };
    entry.count += 1;
    gameCounts.set(key, entry);
  }
  const tagRows = present.length
    ? db
        .select({ name: tags.name, count: sql<number>`count(*)` })
        .from(clipTags)
        .innerJoin(tags, eq(clipTags.tagId, tags.id))
        .where(inArray(clipTags.clipId, present))
        .groupBy(tags.name)
        .all()
    : [];
  const peopleRows = present.length
    ? db
        .select({ username: users.authentikUsername, count: sql<number>`count(*)` })
        .from(clipParticipants)
        .innerJoin(users, eq(clipParticipants.userId, users.id))
        .where(inArray(clipParticipants.clipId, present))
        .groupBy(users.authentikUsername)
        .all()
    : [];
  const byCount = <T extends { count: number }>(a: T, b: T, ka: string, kb: string) => b.count - a.count || ka.localeCompare(kb);
  return {
    total: present.length,
    // Games first by count; "none" (id null) always last.
    games: [...gameCounts.values()].sort((a, b) =>
      a.id === null ? 1 : b.id === null ? -1 : byCount(a, b, a.name, b.name),
    ),
    tags: tagRows.map((t) => ({ name: t.name, count: Number(t.count) })).sort((a, b) => byCount(a, b, a.name, b.name)),
    people: peopleRows
      .map((p) => ({ username: p.username, count: Number(p.count) }))
      .sort((a, b) => byCount(a, b, a.username, b.username)),
  };
}
