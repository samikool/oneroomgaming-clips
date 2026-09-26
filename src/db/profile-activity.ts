import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { clipParticipants, clips, comments } from "./schema";
import { hydrateGridClips, type GridClip } from "./clips";

/** What a profile page shows of someone: what they posted, appear in, and said. */

export type ProfileComment = {
  id: string;
  clipId: string;
  clipTitle: string;
  body: string;
  positionMs: number | null;
  /** Milliseconds since the epoch. */
  at: number;
};

/** Every clip they uploaded, whatever its state, newest first — as the grid shows them. */
export function listUploadsBy(db: Db, userId: string, limit = 60): GridClip[] {
  const rows = db
    .select()
    .from(clips)
    .where(eq(clips.uploaderId, userId))
    .orderBy(desc(clips.createdAt))
    .limit(limit)
    .all();

  return hydrateGridClips(db, rows);
}

export function listAppearancesOf(db: Db, userId: string, limit = 60): GridClip[] {
  const rows = db
    .select()
    .from(clips)
    .where(
      inArray(
        clips.id,
        db.select({ id: clipParticipants.clipId }).from(clipParticipants).where(eq(clipParticipants.userId, userId)),
      ),
    )
    .orderBy(desc(clips.createdAt))
    .limit(limit)
    .all();

  return hydrateGridClips(db, rows);
}

/** Their comments that still stand, newest first. Deleted ones are theirs to have taken back. */
export function listCommentsBy(db: Db, userId: string, limit = 50): ProfileComment[] {
  return db
    .select({
      id: comments.id,
      clipId: comments.clipId,
      clipTitle: clips.title,
      body: comments.body,
      positionMs: comments.positionMs,
      at: comments.createdAt,
    })
    .from(comments)
    .innerJoin(clips, eq(comments.clipId, clips.id))
    .where(and(eq(comments.userId, userId), isNull(comments.deletedAt)))
    // rowid breaks a same-millisecond tie in insertion order. ULIDs would not:
    // within one millisecond their tail is random.
    .orderBy(desc(comments.createdAt), desc(sql`"comments"."rowid"`))
    .limit(limit)
    .all()
    .map((row) => ({ ...row, at: row.at.getTime() }));
}
