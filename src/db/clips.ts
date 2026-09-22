import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { clips, mediaFiles, type Clip, type ClipStatus } from "./schema";
import type { MediaInfo } from "@/lib/media/probe";

export function createClip(
  db: Db,
  input: {
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
      id: ulid(),
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
