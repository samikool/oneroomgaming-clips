import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { activity, clips, likes, users, type ActivityType } from "./schema";
import type { Scores } from "./browse";
import { decayedWeight, VIEW_DEDUPE_MS, WEIGHTS, WINDOW_MS } from "@/lib/activity/scoring";

function exists(db: Db, userId: string, clipId: string): boolean {
  return (
    !!db.select({ id: clips.id }).from(clips).where(eq(clips.id, clipId)).get() &&
    !!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()
  );
}

/** Stores one activity row. False, and nothing stored, when the clip or user is gone. */
export function recordActivity(
  db: Db,
  { type, userId, clipId, at = Date.now() }: { type: ActivityType; userId: string; clipId: string; at?: number },
): boolean {
  if (!exists(db, userId, clipId)) return false;
  db.insert(activity).values({ id: ulid(), type, userId, clipId, at: new Date(at) }).run();
  return true;
}

/** A view, at most once per (user, clip) per 30 minutes. False when deduped or dropped. */
export function recordView(db: Db, userId: string, clipId: string, now = Date.now()): boolean {
  const recent = db
    .select({ id: activity.id })
    .from(activity)
    .where(
      and(
        eq(activity.type, "view"),
        eq(activity.userId, userId),
        eq(activity.clipId, clipId),
        gte(activity.at, new Date(now - VIEW_DEDUPE_MS + 1)),
      ),
    )
    .get();
  return recent ? false : recordActivity(db, { type: "view", userId, clipId, at: now });
}

/** Everything in the window, minus what the clip's own uploader did. */
function windowRows(db: Db, clipIds: string[], now: number) {
  const since = new Date(now - WINDOW_MS);
  const acts = db
    .select({ clipId: activity.clipId, type: activity.type, at: activity.at })
    .from(activity)
    .innerJoin(clips, eq(activity.clipId, clips.id))
    .where(
      and(inArray(activity.clipId, clipIds), gte(activity.at, since), sql`${activity.userId} IS NOT ${clips.uploaderId}`),
    )
    .all()
    .map((r) => ({ clipId: r.clipId, weight: WEIGHTS[r.type], at: r.at.getTime() }));
  // A like on your own clip is refused at write time, so likes need no uploader filter.
  const likeRows = db
    .select({ clipId: likes.clipId, at: likes.createdAt })
    .from(likes)
    .where(and(inArray(likes.clipId, clipIds), gte(likes.createdAt, since)))
    .all()
    .map((r) => ({ clipId: r.clipId, weight: WEIGHTS.like, at: r.at.getTime() }));
  return [...acts, ...likeRows];
}

function counts(rows: { clipId: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { clipId } of rows) out.set(clipId, (out.get(clipId) ?? 0) + 1);
  return out;
}

/**
 * Trending and Top numbers from the activity and likes tables. Computed in JS
 * over the 7-day row set at query time: small at this scale, and no cache or
 * cron to go stale. A factory, because `Scores` methods take no db.
 */
export function activityScores(db: Db): Scores {
  return {
    trending(clipIds, now) {
      const out = new Map<string, number>();
      if (clipIds.length === 0) return out;
      for (const row of windowRows(db, clipIds, now)) {
        out.set(row.clipId, (out.get(row.clipId) ?? 0) + decayedWeight(row.weight, now - row.at));
      }
      return out;
    },
    likes(clipIds) {
      if (clipIds.length === 0) return new Map();
      return counts(db.select({ clipId: likes.clipId }).from(likes).where(inArray(likes.clipId, clipIds)).all());
    },
    activity(clipIds) {
      if (clipIds.length === 0) return new Map();
      return counts(
        db.select({ clipId: activity.clipId }).from(activity).where(inArray(activity.clipId, clipIds)).all(),
      );
    },
    likedBy(userId, clipIds) {
      if (clipIds.length === 0) return new Set();
      return new Set(
        db
          .select({ clipId: likes.clipId })
          .from(likes)
          .where(and(eq(likes.userId, userId), inArray(likes.clipId, clipIds)))
          .all()
          .map((r) => r.clipId),
      );
    },
  };
}
