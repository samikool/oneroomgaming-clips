import { and, asc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { comments, users } from "./schema";

/**
 * A comment as the UI and the wire both want it: the author's Authentik
 * username rather than their ULID, and a millisecond timestamp rather than a
 * Date. Matches `CommentSummary` field for field, so announcing one needs no
 * mapping.
 */
export type CommentRow = {
  id: string;
  clipId: string;
  user: string;
  body: string;
  at: number;
  deleted: boolean;
};

/** What a deleted comment says in place of its body. */
export const TOMBSTONE = "[deleted]";

type Joined = {
  id: string;
  clipId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  username: string | null;
};

function toRow(row: Joined): CommentRow {
  const deleted = row.deletedAt !== null;

  return {
    id: row.id,
    clipId: row.clipId,
    // The body never leaves the database once deleted. Sending the text with
    // a flag and hiding it in CSS is not deletion.
    body: deleted ? TOMBSTONE : row.body,
    user: row.username ?? "unknown",
    at: row.createdAt.getTime(),
    deleted,
  };
}

const SELECTION = {
  id: comments.id,
  clipId: comments.clipId,
  body: comments.body,
  createdAt: comments.createdAt,
  deletedAt: comments.deletedAt,
  username: users.authentikUsername,
};

export function addComment(
  db: Db,
  input: { clipId: string; userId: string; body: string },
): CommentRow {
  const id = ulid();
  db.insert(comments)
    .values({
      id,
      clipId: input.clipId,
      userId: input.userId,
      body: input.body,
      // Nullable and deliberately unused. It exists so playhead-anchored
      // comments become a UI change with no migration.
      positionMs: null,
      createdAt: new Date(),
      deletedAt: null,
    })
    .run();

  const row = getComment(db, id);

  if (!row) {
    throw new Error(`comment ${id} vanished immediately after insert`);
  }

  return row;
}

export function getComment(db: Db, id: string): CommentRow | undefined {
  const row = db
    .select(SELECTION)
    .from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.id, id))
    .get();

  return row ? toRow(row as Joined) : undefined;
}

/** Oldest first, so a thread reads top to bottom. Tombstones included. */
export function listComments(db: Db, clipId: string): CommentRow[] {
  return db
    .select(SELECTION)
    .from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.clipId, clipId))
    .orderBy(asc(comments.createdAt))
    .all()
    .map((row) => toRow(row as Joined));
}

/**
 * Soft-deletes a comment, but only for its author.
 *
 * Metadata on this site is communal; a comment is someone's words, and
 * deleting it is theirs alone.
 */
export function softDeleteComment(db: Db, id: string, userId: string): boolean {
  const existing = db
    .select({ id: comments.id, deletedAt: comments.deletedAt })
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.userId, userId)))
    .get();

  if (!existing) {
    return false;
  }

  if (existing.deletedAt !== null) {
    return true;
  }

  db.update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, id), eq(comments.userId, userId), isNull(comments.deletedAt)))
    .run();

  return true;
}
