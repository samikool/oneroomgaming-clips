import { and, count, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { clips, likes, users } from "./schema";

/** One like per person per clip. Never your own clip. */
export function like(
  db: Db,
  userId: string,
  clipId: string,
  now = Date.now(),
): "liked" | "already" | "own" | "missing" {
  const clip = db.select({ uploaderId: clips.uploaderId }).from(clips).where(eq(clips.id, clipId)).get();
  if (!clip) return "missing";
  if (clip.uploaderId === userId) return "own";
  const inserted = db.insert(likes).values({ userId, clipId, createdAt: new Date(now) }).onConflictDoNothing().returning().get();
  return inserted ? "liked" : "already";
}

/** True when a like was removed; unliking what you never liked does nothing. */
export function unlike(db: Db, userId: string, clipId: string): boolean {
  return db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.clipId, clipId))).returning().all().length > 0;
}

export function likeCount(db: Db, clipId: string): number {
  return db.select({ n: count() }).from(likes).where(eq(likes.clipId, clipId)).get()?.n ?? 0;
}

/** Who liked a clip, newest first. */
export function likers(db: Db, clipId: string): { username: string; at: number }[] {
  return db
    .select({ username: users.authentikUsername, at: likes.createdAt })
    .from(likes)
    .innerJoin(users, eq(likes.userId, users.id))
    .where(eq(likes.clipId, clipId))
    .orderBy(desc(likes.createdAt))
    .all()
    .map((row) => ({ username: row.username, at: row.at.getTime() }));
}
