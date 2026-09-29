import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { plausibleRecordedAt } from "@/lib/media/recorded";
import { ulid } from "ulid";
import type { Db } from "./client";
import {
  activity,
  clipParticipants,
  clips,
  clipTags,
  collectionClips,
  collections,
  comments,
  games,
  jobs,
  likes,
  mediaFiles,
  notifications,
  tags,
  users,
  type Clip,
  type ClipStatus,
} from "./schema";
import type { MediaInfo } from "@/lib/media/probe";
import { reindexClip } from "./search";

export function createClip(
  db: Db,
  input: {
    id?: string;
    title: string;
    originalFilename: string;
    sizeBytes: number;
    uploaderId?: string | null;
    recordedAt?: Date | null;
    fingerprint?: string | null;
  },
  now: Date = new Date(),
): Clip {
  const clip = db
    .insert(clips)
    .values({
      id: input.id ?? ulid(),
      title: input.title,
      originalFilename: input.originalFilename,
      uploaderId: input.uploaderId ?? null,
      fingerprint: input.fingerprint ?? null,
      gameId: null,
      status: "pending",
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      sizeBytes: input.sizeBytes,
      recordedAt: input.recordedAt ?? null,
      thumbPath: null,
      errorMessage: null,
      createdAt: now,
    })
    .returning()
    .get();

  reindexClip(db, clip.id);
  return clip;
}

export function applyProbe(db: Db, clipId: string, info: MediaInfo): Clip {
  // The video's own stamp fills an empty date only: a date from the filename
  // or the uploader always wins, and zeroed stamps are not dates.
  const current = getClip(db, clipId);
  const fromVideo =
    current && current.recordedAt === null && info.createdAt != null && plausibleRecordedAt(info.createdAt)
      ? { recordedAt: new Date(info.createdAt) }
      : {};
  return db
    .update(clips)
    .set({
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      sizeBytes: info.sizeBytes,
      ...fromVideo,
    })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function setClipStatus(
  db: Db,
  clipId: string,
  status: ClipStatus,
  errorMessage: string | null = null,
): Clip {
  return db
    .update(clips)
    .set({ status, errorMessage })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function setClipThumb(db: Db, clipId: string, thumbPath: string): Clip {
  return db
    .update(clips)
    .set({ thumbPath })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function recordMediaFile(
  db: Db,
  clipId: string,
  input: { kind: string; path: string; info: MediaInfo; isDefault: boolean },
  now: Date = new Date(),
): void {
  db.transaction(() => {
  db.delete(mediaFiles).where(and(eq(mediaFiles.clipId, clipId), eq(mediaFiles.kind, input.kind))).run();
  db.insert(mediaFiles)
    .values({
      id: ulid(),
      clipId,
      kind: input.kind,
      path: input.path,
      container: input.info.container,
      videoCodec: input.info.videoCodec,
      audioCodec: input.info.audioCodec,
      width: input.info.width,
      height: input.info.height,
      bitrate: input.info.bitrate,
      sizeBytes: input.info.sizeBytes,
      isDefault: input.isDefault,
      createdAt: now,
    })
    .run();
  });
}

export function listReadyClips(db: Db, limit = 100): Clip[] {
  return db
    .select()
    .from(clips)
    .where(eq(clips.status, "ready"))
    .orderBy(desc(clips.createdAt))
    .limit(limit)
    .all();
}

/**
 * id → thumbnail of every ready clip: all the theater's queue needs to show a
 * picture beside an entry, without shipping the whole library to the page.
 */
export function listReadyThumbs(db: Db): Record<string, string | null> {
  return Object.fromEntries(
    db
      .select({ id: clips.id, thumbPath: clips.thumbPath })
      .from(clips)
      .where(eq(clips.status, "ready"))
      .all()
      .map((row) => [row.id, row.thumbPath]),
  );
}

export function listAllClips(db: Db, limit = 100): Clip[] {
  return db.select().from(clips).orderBy(desc(clips.createdAt)).limit(limit).all();
}

/** The clip already made from this exact file, if any. */
export function findClipByFingerprint(db: Db, fingerprint: string): Clip | undefined {
  return db.select().from(clips).where(eq(clips.fingerprint, fingerprint)).get();
}

export function getClip(db: Db, id: string): Clip | undefined {
  return db.select().from(clips).where(eq(clips.id, id)).get();
}

export function deleteClip(db: Db, id: string): void {
  db.delete(clips).where(eq(clips.id, id)).run();
}

/**
 * Removes a clip and everything that references it, in one transaction.
 *
 * `deleteClip` above cannot do this. `PRAGMA foreign_keys` is ON and not one
 * child FK declares `onDelete`, so a bare delete raises FOREIGN KEY constraint
 * failed for any clip that has ever been through the pipeline — every real
 * clip has `jobs` and `media_files` rows.
 *
 * Children before the parent, and all of it inside a transaction: a partial
 * cascade would leave rows pointing at a clip that no longer exists.
 *
 * `tags` and `games` rows are deliberately NOT removed. They are shared
 * vocabulary — deleting the last clip tagged "ace" should not delete the tag
 * other clips may get later. Only the join rows go.
 *
 * Files on disk are not touched here. The caller unlinks them AFTER this
 * commits, so a rolled-back transaction never leaves the video gone.
 */
export function deleteClipCascade(db: Db, id: string): void {
  db.transaction((tx) => {
    // Notifications first: they reference comments as well as the clip.
    tx.delete(notifications).where(eq(notifications.clipId, id)).run();
    tx.delete(activity).where(eq(activity.clipId, id)).run();
    tx.delete(likes).where(eq(likes.clipId, id)).run();
    tx.delete(comments).where(eq(comments.clipId, id)).run();
    tx.delete(clipTags).where(eq(clipTags.clipId, id)).run();
    tx.delete(clipParticipants).where(eq(clipParticipants.clipId, id)).run();
    // Out of every collection, closing the gap it leaves so positions stay
    // dense, and bumping each one's updatedAt like any other removal.
    const memberships = tx
      .delete(collectionClips)
      .where(eq(collectionClips.clipId, id))
      .returning({ collectionId: collectionClips.collectionId, position: collectionClips.position })
      .all();
    for (const { collectionId, position } of memberships) {
      tx.update(collectionClips)
        .set({ position: sql`${collectionClips.position} - 1` })
        .where(and(eq(collectionClips.collectionId, collectionId), gt(collectionClips.position, position)))
        .run();
      tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId)).run();
    }
    tx.delete(jobs).where(eq(jobs.clipId, id)).run();
    tx.delete(mediaFiles).where(eq(mediaFiles.clipId, id)).run();
    tx.run(sql`DELETE FROM clip_search WHERE clip_id = ${id}`);
    tx.delete(clips).where(eq(clips.id, id)).run();
  });
}

/** One value per field; the old grid's filters. The browser uses `BrowseQuery`. */
export type ClipFilters = {
  tag?: string;
  game?: string;
  uploader?: string;
  participant?: string;
};

/**
 * The grid's query. Filters AND together, newest first.
 *
 * Each filter is expressed as a subquery on the clip id rather than a join,
 * because joining against `clip_tags` multiplies rows and would render the
 * same card once per tag.
 */
export function listClips(db: Db, filters: ClipFilters = {}, limit = 100): Clip[] {
  const conditions = [];

  if (filters.tag) {
    conditions.push(
      inArray(
        clips.id,
        db
          .select({ id: clipTags.clipId })
          .from(clipTags)
          .innerJoin(tags, eq(clipTags.tagId, tags.id))
          .where(eq(tags.name, filters.tag.toLowerCase())),
      ),
    );
  }

  if (filters.game) {
    conditions.push(
      inArray(
        clips.gameId,
        db.select({ id: games.id }).from(games).where(eq(games.slug, filters.game)),
      ),
    );
  }

  if (filters.uploader) {
    conditions.push(
      inArray(
        clips.uploaderId,
        db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authentikUsername, filters.uploader)),
      ),
    );
  }

  if (filters.participant) {
    conditions.push(
      inArray(
        clips.id,
        db
          .select({ id: clipParticipants.clipId })
          .from(clipParticipants)
          .innerJoin(users, eq(clipParticipants.userId, users.id))
          .where(eq(users.authentikUsername, filters.participant)),
      ),
    );
  }

  const query = db.select().from(clips);
  const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;

  return filtered.orderBy(desc(clips.createdAt)).limit(limit).all();
}

/**
 * Total bytes the library occupies, as recorded by the pipeline.
 *
 * Surfaced in the UI because it is useful to know; there are no quotas. A
 * clip whose probe has not run yet has no size and contributes nothing.
 */
export function totalDiskBytes(db: Db): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${clips.sizeBytes}), 0)` })
    .from(clips)
    .get();

  return row?.total ?? 0;
}

export type GridClip = Clip & {
  uploader: string | null;
  game: { name: string; slug: string } | null;
};

/**
 * `listClips` plus the two fields a card can be clicked on.
 *
 * A second pass rather than a wider join in `listClips`: that function's
 * subquery-per-filter shape is what keeps a multi-tag clip from appearing
 * twice, and widening it would undo that.
 */
/** Adds the uploader's username and the game to each row, in the order given. */
export function hydrateGridClips(db: Db, rows: Clip[]): GridClip[] {
  if (rows.length === 0) {
    return [];
  }

  const uploaderIds = [...new Set(rows.map((r) => r.uploaderId).filter((id): id is string => !!id))];
  const gameIds = [...new Set(rows.map((r) => r.gameId).filter((id): id is string => !!id))];

  const uploaders = new Map(
    uploaderIds.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.authentikUsername })
          .from(users)
          .where(inArray(users.id, uploaderIds))
          .all()
          .map((u) => [u.id, u.name] as const),
  );

  const gameRows = new Map(
    gameIds.length === 0
      ? []
      : db
          .select({ id: games.id, name: games.name, slug: games.slug })
          .from(games)
          .where(inArray(games.id, gameIds))
          .all()
          .map((g) => [g.id, { name: g.name, slug: g.slug }] as const),
  );

  return rows.map((row) => ({
    ...row,
    uploader: row.uploaderId ? (uploaders.get(row.uploaderId) ?? null) : null,
    game: row.gameId ? (gameRows.get(row.gameId) ?? null) : null,
  }));
}
