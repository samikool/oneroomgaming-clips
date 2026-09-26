import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { clipParticipants, clips, clipTags, games, tags, users } from "./schema";
import { hydrateGridClips } from "./clips";
import { searchClipIds } from "./search";
import type { BrowseQuery } from "@/lib/browse/query";
import { decodeCursor, encodeCursor } from "@/lib/browse/cursor";
import { seededShuffle } from "@/lib/browse/shuffle";
import { toSummary } from "@/lib/events/clips";
import type { ClipSummary } from "@/lib/realtime/envelope";

export type Scope = "home" | "theater";
export const PAGE_SIZE = 24;

/**
 * Where Trending and Top get their numbers. Activity tracking (0.4.0 spec 2)
 * supplies the real implementation; until then everything scores zero, which
 * is the honest answer for a site that records no activity yet.
 */
export interface Scores {
  trending(clipIds: string[], now: number): Map<string, number>;
  likes(clipIds: string[]): Map<string, number>;
  activity(clipIds: string[]): Map<string, number>;
  likedBy(userId: string, clipIds: string[]): Set<string>;
}

export const zeroScores: Scores = {
  trending: () => new Map(),
  likes: () => new Map(),
  activity: () => new Map(),
  likedBy: () => new Set(),
};

type Candidate = { id: string; createdAt: number };

/** Every clip id matching the filters and scope, as a subquery per field so no clip repeats. */
function candidates(db: Db, query: BrowseQuery, scope: Scope): Candidate[] {
  const where: SQL[] = [];

  if (!(scope === "home" && query.sort === "new")) {
    where.push(eq(clips.status, "ready"));
  }

  if (query.games.length > 0) {
    where.push(inArray(clips.gameId, db.select({ id: games.id }).from(games).where(inArray(games.slug, query.games))));
  }

  if (query.tags.length > 0) {
    where.push(
      inArray(
        clips.id,
        db
          .select({ id: clipTags.clipId })
          .from(clipTags)
          .innerJoin(tags, eq(clipTags.tagId, tags.id))
          .where(inArray(tags.name, query.tags)),
      ),
    );
  }

  if (query.people.length > 0) {
    const personIds = db.select({ id: users.id }).from(users).where(inArray(users.authentikUsername, query.people));
    const asUploader = inArray(clips.uploaderId, personIds);
    const asParticipant = inArray(
      clips.id,
      db.select({ id: clipParticipants.clipId }).from(clipParticipants).where(inArray(clipParticipants.userId, personIds)),
    );
    where.push(or(asUploader, asParticipant)!);
  }

  const rows = db
    .select({ id: clips.id, createdAt: clips.createdAt })
    .from(clips)
    .where(where.length > 0 ? and(...where) : undefined)
    .all();

  const matched = searchClipIds(db, query.q);
  const kept = matched === null ? rows : rows.filter((row) => matched.has(row.id));

  return kept.map((row) => ({ id: row.id, createdAt: row.createdAt.getTime() }));
}

function newestFirst(a: Candidate, b: Candidate): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);
}

function rank(query: BrowseQuery, list: Candidate[], scores: Scores, now: number): string[] {
  const ids = list.map((c) => c.id);

  switch (query.sort) {
    case "new":
      return [...list].sort(newestFirst).map((c) => c.id);
    case "random":
      return seededShuffle([...ids].sort(), query.seed);
    case "trending": {
      const score = scores.trending(ids, now);
      return list
        .filter((c) => (score.get(c.id) ?? 0) > 0)
        .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || newestFirst(a, b))
        .map((c) => c.id);
    }
    case "top": {
      const likes = scores.likes(ids);
      const activity = scores.activity(ids);
      return [...list]
        .sort(
          (a, b) =>
            (likes.get(b.id) ?? 0) - (likes.get(a.id) ?? 0) ||
            (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) ||
            newestFirst(a, b),
        )
        .map((c) => c.id);
    }
  }
}

/**
 * One tab's page. Ranks every matching clip and slices; fine to several
 * thousand clips, which is years of uploads for this group. If that stops
 * being true, cache trending scores — not before.
 */
export function browseClips(
  db: Db,
  query: BrowseQuery,
  {
    cursor,
    limit = PAGE_SIZE,
    scope,
    userId,
    scores = zeroScores,
    now = Date.now(),
  }: { cursor?: string | null; limit?: number; scope: Scope; userId: string; scores?: Scores; now?: number },
): { clips: ClipSummary[]; next: string | null } {
  const ordered = rank(query, candidates(db, query, scope), scores, now);
  const offset = decodeCursor(cursor, query.sort);
  const pageIds = ordered.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return { clips: [], next: null };
  }

  const rows = db.select().from(clips).where(inArray(clips.id, pageIds)).all();
  const byId = new Map(hydrateGridClips(db, rows).map((row) => [row.id, row]));
  const likes = scores.likes(pageIds);
  const mine = scores.likedBy(userId, pageIds);

  return {
    clips: pageIds
      .map((id) => byId.get(id))
      .filter((row) => row !== undefined)
      .map((row) => ({ ...toSummary(row), likeCount: likes.get(row.id) ?? 0, likedByMe: mine.has(row.id) })),
    next: offset + limit < ordered.length ? encodeCursor(query.sort, offset + limit) : null,
  };
}
