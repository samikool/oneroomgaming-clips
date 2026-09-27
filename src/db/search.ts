import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { clipParticipants, clips, clipTags, comments, games, tags, users } from "./schema";
import { toFtsQuery } from "@/lib/browse/fts";

/** Everything a person might type to find this clip, as one FTS row. */
function documentFor(db: Db, clipId: string) {
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get();

  if (!clip) {
    return null;
  }

  const game = clip.gameId
    ? (db.select({ name: games.name }).from(games).where(eq(games.id, clip.gameId)).get()?.name ?? "")
    : "";

  const tagNames = db
    .select({ name: tags.name })
    .from(clipTags)
    .innerJoin(tags, eq(clipTags.tagId, tags.id))
    .where(eq(clipTags.clipId, clipId))
    .all()
    .map((row) => row.name);

  const personIds = [
    ...(clip.uploaderId ? [clip.uploaderId] : []),
    ...db
      .select({ id: clipParticipants.userId })
      .from(clipParticipants)
      .where(eq(clipParticipants.clipId, clipId))
      .all()
      .map((row) => row.id),
  ];
  // Username, the Authentik name, and the name they chose for themselves.
  const people =
    personIds.length === 0
      ? []
      : db
          .select({ username: users.authentikUsername, displayName: users.displayName, profileName: users.profileName })
          .from(users)
          .where(inArray(users.id, personIds))
          .all()
          .flatMap((u) => [u.username, u.displayName ?? "", u.profileName ?? ""]);

  const commentText = db
    .select({ body: comments.body })
    .from(comments)
    .where(and(eq(comments.clipId, clipId), isNull(comments.deletedAt)))
    .all()
    .map((row) => row.body);

  return {
    title: clip.title,
    game,
    tags: tagNames.join(" "),
    people: people.join(" "),
    comments: commentText.join("\n"),
  };
}

/** Deletes and rewrites one clip's search row, or only deletes it when the clip is gone. */
export function reindexClip(db: Db, clipId: string): void {
  db.run(sql`DELETE FROM clip_search WHERE clip_id = ${clipId}`);
  const doc = documentFor(db, clipId);

  if (doc) {
    db.run(
      sql`INSERT INTO clip_search (clip_id, title, game, tags, people, comments)
          VALUES (${clipId}, ${doc.title}, ${doc.game}, ${doc.tags}, ${doc.people}, ${doc.comments})`,
    );
  }
}

/** A name changed: every clip this person uploaded or appears in. */
export function reindexUserClips(db: Db, userId: string): void {
  const uploaded = db.select({ id: clips.id }).from(clips).where(eq(clips.uploaderId, userId)).all();
  const appearsIn = db
    .select({ id: clipParticipants.clipId })
    .from(clipParticipants)
    .where(eq(clipParticipants.userId, userId))
    .all();

  for (const id of new Set([...uploaded, ...appearsIn].map((row) => row.id))) {
    reindexClip(db, id);
  }
}

export function reindexAll(db: Db): number {
  const ids = db.select({ id: clips.id }).from(clips).all().map((row) => row.id);

  db.transaction((tx) => {
    tx.run(sql`DELETE FROM clip_search`);
    for (const id of ids) {
      reindexClip(tx as unknown as Db, id);
    }
  });

  return ids.length;
}

export function searchIndexIsEmpty(db: Db): boolean {
  return (db.get<{ n: number }>(sql`SELECT count(*) AS n FROM clip_search`)?.n ?? 0) === 0;
}

/** The clip ids matching a search, or null when there is nothing to search for. */
export function searchClipIds(db: Db, q: string): Set<string> | null {
  const match = toFtsQuery(q);

  if (match === null) {
    return null;
  }

  const rows = db.all<{ clip_id: string }>(sql`SELECT clip_id FROM clip_search WHERE clip_search MATCH ${match}`);
  return new Set(rows.map((row) => row.clip_id));
}
