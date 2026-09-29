import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { clips, comments, notifications, users, type NotificationType } from "./schema";
import type { NotificationSummary } from "@/lib/realtime/envelope";

export type { NotificationSummary };

export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const EXCERPT_MAX = 80;
export const PAGE_SIZE = 30;

type Row = typeof notifications.$inferSelect;

function excerptOf(body: string): string {
  const points = [...body];
  return points.length > EXCERPT_MAX ? `${points.slice(0, EXCERPT_MAX).join("")}…` : body;
}

function parseActors(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

function summarize(db: Db, rows: Row[]): NotificationSummary[] {
  if (rows.length === 0) return [];
  const clipIds = [...new Set(rows.map((r) => r.clipId))];
  const commentIds = [...new Set(rows.map((r) => r.commentId).filter((id): id is string => !!id))];
  const titles = new Map(
    db.select({ id: clips.id, title: clips.title }).from(clips).where(inArray(clips.id, clipIds)).all().map((c) => [c.id, c.title]),
  );
  const bodies = new Map(
    commentIds.length === 0
      ? []
      : db
          .select({ id: comments.id, body: comments.body, deletedAt: comments.deletedAt })
          .from(comments)
          .where(inArray(comments.id, commentIds))
          .all()
          // A deleted comment's words never leave the database.
          .map((c) => [c.id, c.deletedAt ? null : c.body] as const),
  );
  const bulkRecipients = [...new Set(rows.filter((r) => r.type === "tagged_bulk").map((r) => r.recipientId))];
  const usernames = new Map(
    bulkRecipients.length === 0
      ? []
      : db
          .select({ id: users.id, username: users.authentikUsername })
          .from(users)
          .where(inArray(users.id, bulkRecipients))
          .all()
          .map((u) => [u.id, u.username] as const),
  );

  return rows.map((row) => {
    const body = row.commentId ? bodies.get(row.commentId) : null;
    return {
      id: row.id,
      type: row.type,
      clipId: row.clipId,
      clipTitle: titles.get(row.clipId) ?? "",
      actors: parseActors(row.actors),
      commentId: row.commentId,
      excerpt: body ? excerptOf(body) : null,
      positionMs: row.positionMs,
      source: row.source,
      updatedAt: row.updatedAt.getTime(),
      read: row.readAt !== null,
      count: row.count,
      recipient: row.type === "tagged_bulk" ? usernames.get(row.recipientId) ?? null : null,
    };
  });
}

/**
 * Records that `actor` did something `recipientId` should hear about.
 *
 * Joins the recipient's unread group for the same (type, clip) — moving the
 * actor to the front — or starts a new one. Mentions never group. Every write
 * prunes the recipient's rows older than 90 days. Null, and nothing stored,
 * when the clip is gone.
 */
export function notify(
  db: Db,
  {
    recipientId,
    type,
    clipId,
    actor,
    commentId = null,
    positionMs = null,
    source = null,
    count = null,
    now = Date.now(),
  }: {
    recipientId: string;
    type: NotificationType;
    clipId: string;
    actor: string;
    commentId?: string | null;
    positionMs?: number | null;
    source?: "comment" | "chat" | null;
    /** tagged_bulk: how many clips. */
    count?: number | null;
    now?: number;
  },
): NotificationSummary | null {
  const row = db.transaction((tx) => {
    if (!tx.select({ id: clips.id }).from(clips).where(eq(clips.id, clipId)).get()) return null;

    const at = new Date(now);
    const group =
      // A mention or a bulk tag is its own moment; neither joins a group.
      type === "mention" || type === "tagged_bulk"
        ? undefined
        : tx
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.recipientId, recipientId),
                eq(notifications.type, type),
                eq(notifications.clipId, clipId),
                isNull(notifications.readAt),
              ),
            )
            .orderBy(desc(notifications.updatedAt))
            .get();

    const written = group
      ? tx
          .update(notifications)
          .set({
            actors: JSON.stringify([actor, ...parseActors(group.actors).filter((a) => a !== actor)]),
            updatedAt: at,
            // The newest comment is the one worth linking to.
            ...(commentId !== null && { commentId, positionMs }),
          })
          .where(eq(notifications.id, group.id))
          .returning()
          .get()
      : tx
          .insert(notifications)
          .values({
            id: ulid(),
            recipientId,
            type,
            clipId,
            commentId,
            actors: JSON.stringify([actor]),
            positionMs,
            source,
            count,
            createdAt: at,
            updatedAt: at,
            readAt: null,
          })
          .returning()
          .get();

    tx.delete(notifications)
      .where(and(eq(notifications.recipientId, recipientId), lt(notifications.updatedAt, new Date(now - RETENTION_MS))))
      .run();

    return written;
  });

  return row ? summarize(db, [row])[0] : null;
}

/**
 * Takes an unliker out of the recipient's unread like group. "deleted" when
 * that empties it; null when there's no unread group (a read one stays as it was).
 */
export function retractLike(
  db: Db,
  { recipientId, clipId, actor }: { recipientId: string; clipId: string; actor: string },
): NotificationSummary | "deleted" | null {
  const result = db.transaction((tx): Row | "deleted" | null => {
    const group = tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, "like"),
          eq(notifications.clipId, clipId),
          isNull(notifications.readAt),
        ),
      )
      .get();
    if (!group) return null;

    const actors = parseActors(group.actors).filter((a) => a !== actor);
    if (actors.length === 0) {
      tx.delete(notifications).where(eq(notifications.id, group.id)).run();
      return "deleted";
    }
    return tx
      .update(notifications)
      .set({ actors: JSON.stringify(actors) })
      .where(eq(notifications.id, group.id))
      .returning()
      .get();
  });

  if (result === null || result === "deleted") return result;
  return summarize(db, [result])[0];
}

/** Newest first by last activity. `before` is an `updatedAt` cursor. */
export function listNotifications(
  db: Db,
  recipientId: string,
  { before, limit = PAGE_SIZE }: { before?: number; limit?: number } = {},
): NotificationSummary[] {
  const rows = db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        before === undefined ? undefined : lt(notifications.updatedAt, new Date(before)),
      ),
    )
    .orderBy(desc(notifications.updatedAt), desc(notifications.id))
    .limit(limit)
    .all();
  return summarize(db, rows);
}

export function unreadCount(db: Db, recipientId: string): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

/** Marks these as read — only the recipient's own, and only once. */
export function markRead(db: Db, recipientId: string, ids: string[], now = Date.now()): void {
  if (ids.length === 0) return;
  db.update(notifications)
    .set({ readAt: new Date(now) })
    .where(and(inArray(notifications.id, ids), eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
    .run();
}
