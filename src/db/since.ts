import { and, count, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import type { Db } from "./client";
import { clips, comments, likes, type User } from "./schema";

export type SinceLastVisit = {
  /** When the previous visit started, in ms. */
  since: number;
  /** Up to 8, newest first. */
  newClips: { id: string; title: string; thumbPath: string | null }[];
  newClipCount: number;
  /** On your clips, by other people. */
  likes: number;
  comments: number;
};

const THUMBS = 8;

/**
 * What happened while you were away: other people's new clips, and the likes
 * and comments your clips got. Null on a first visit, or when nothing did.
 */
export function sinceLastVisit(db: Db, user: User): SinceLastVisit | null {
  if (!user.previousVisitAt) return null;
  const since = user.previousVisitAt;

  const notMine = or(isNull(clips.uploaderId), ne(clips.uploaderId, user.id));
  const fresh = and(eq(clips.status, "ready"), gt(clips.createdAt, since), notMine);

  const newClipCount = db.select({ n: count() }).from(clips).where(fresh).get()?.n ?? 0;
  const newClips =
    newClipCount === 0
      ? []
      : db
          .select({ id: clips.id, title: clips.title, thumbPath: clips.thumbPath })
          .from(clips)
          .where(fresh)
          .orderBy(desc(clips.createdAt), desc(clips.id))
          .limit(THUMBS)
          .all();

  const likeCount =
    db
      .select({ n: count() })
      .from(likes)
      .innerJoin(clips, eq(likes.clipId, clips.id))
      .where(and(eq(clips.uploaderId, user.id), ne(likes.userId, user.id), gt(likes.createdAt, since)))
      .get()?.n ?? 0;

  const commentCount =
    db
      .select({ n: count() })
      .from(comments)
      .innerJoin(clips, eq(comments.clipId, clips.id))
      .where(
        and(
          eq(clips.uploaderId, user.id),
          ne(comments.userId, user.id),
          gt(comments.createdAt, since),
          isNull(comments.deletedAt),
        ),
      )
      .get()?.n ?? 0;

  if (newClipCount === 0 && likeCount === 0 && commentCount === 0) return null;
  return { since: since.getTime(), newClips, newClipCount, likes: likeCount, comments: commentCount };
}
