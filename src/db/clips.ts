import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import {
  clipParticipants,
  clips,
  clipTags,
  comments,
  games,
  jobs,
  mediaFiles,
  tags,
  users,
  views,
  type Clip,
  type ClipStatus,
} from "./schema";
import type { ClipFilters } from "@/lib/filters";
import type { MediaInfo } from "@/lib/media/probe";

export function createClip(
  db: Db,
  input: {
    id?: string;
    title: string;
    originalFilename: string;
    sizeBytes: number;
    uploaderId?: string | null;
    recordedAt?: Date | null;
  },
  now: Date = new Date(),
): Clip {
  return db
    .insert(clips)
    .values({
      id: input.id ?? ulid(),
      title: input.title,
      originalFilename: input.originalFilename,
      uploaderId: input.uploaderId ?? null,
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
}

export function applyProbe(db: Db, clipId: string, info: MediaInfo): Clip {
  return db
    .update(clips)
    .set({
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      sizeBytes: info.sizeBytes,
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

export function listAllClips(db: Db, limit = 100): Clip[] {
  return db.select().from(clips).orderBy(desc(clips.createdAt)).limit(limit).all();
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
    tx.delete(comments).where(eq(comments.clipId, id)).run();
    tx.delete(clipTags).where(eq(clipTags.clipId, id)).run();
    tx.delete(clipParticipants).where(eq(clipParticipants.clipId, id)).run();
    tx.delete(views).where(eq(views.clipId, id)).run();
    tx.delete(jobs).where(eq(jobs.clipId, id)).run();
    tx.delete(mediaFiles).where(eq(mediaFiles.clipId, id)).run();
    tx.delete(clips).where(eq(clips.id, id)).run();
  });
}

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
export function listClipsForGrid(db: Db, filters: ClipFilters = {}, limit = 100): GridClip[] {
  const rows = listClips(db, filters, limit);

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
