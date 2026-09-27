import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { enqueueJob } from "@/db/jobs";
import { clips, games, jobs, users, type ClipStatus } from "@/db/schema";
import { reindexClip, searchClipIds } from "@/db/search";

export const ADMIN_PAGE_SIZE = 50;
const TITLE_MAX = 200;

export type AdminClip = {
  id: string;
  title: string;
  uploader: string | null;
  game: string | null;
  status: ClipStatus;
  sizeBytes: number | null;
  /** Epoch milliseconds. */
  createdAt: number;
  thumbPath: string | null;
  errorMessage: string | null;
};

export const CLIP_STATUSES: ClipStatus[] = ["pending", "processing", "ready", "needs_transcode", "failed"];

/**
 * Every clip, whatever its status, newest first, a page at a time. `q` goes
 * through the same search index as the browser; `status` narrows further.
 */
export function listAdminClips(
  db: Db,
  { q, status, page = 0 }: { q?: string; status?: ClipStatus; page?: number },
): { rows: AdminClip[]; total: number } {
  const conditions: SQL[] = [];
  const matched = q ? searchClipIds(db, q) : null;

  if (matched !== null) {
    if (matched.size === 0) {
      return { rows: [], total: 0 };
    }
    conditions.push(inArray(clips.id, [...matched]));
  }

  if (status) {
    conditions.push(eq(clips.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = db.select({ n: count() }).from(clips).where(where).get()?.n ?? 0;
  const rows = db
    .select({
      id: clips.id,
      title: clips.title,
      uploader: users.authentikUsername,
      game: games.name,
      status: clips.status,
      sizeBytes: clips.sizeBytes,
      createdAt: clips.createdAt,
      thumbPath: clips.thumbPath,
      errorMessage: clips.errorMessage,
    })
    .from(clips)
    .leftJoin(users, eq(users.id, clips.uploaderId))
    .leftJoin(games, eq(games.id, clips.gameId))
    .where(where)
    .orderBy(desc(clips.createdAt), desc(clips.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset(Math.max(0, Math.floor(page)) * ADMIN_PAGE_SIZE)
    .all();

  return { rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })), total };
}

export function updateClipTitle(db: Db, id: string, title: string): { ok: true } | { ok: false; error: string } {
  const trimmed = title.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "A title can't be empty." };
  }

  if ([...trimmed].length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: `Titles are at most ${TITLE_MAX} plain characters.` };
  }

  db.transaction(() => {
    db.update(clips).set({ title: trimmed }).where(eq(clips.id, id)).run();
    reindexClip(db, id);
  });

  return { ok: true };
}

/**
 * Runs the pipeline again from the first stage (probe, as at upload).
 *
 * Refused while any job for the clip is queued or running: two pipelines on
 * one clip would race on the same files.
 *
 * The clip's old job rows are removed first. Pipeline stages are single-use
 * per clip (`enqueueStage` returns an existing row rather than adding one),
 * so a leftover remux or thumbnail row would stop the rerun at that stage.
 * The history goes with them; the clip's `error_message` is cleared too.
 *
 * Whether the source file is still on disk is the caller's concern (see
 * `ensureReprocessSource`): this is the database half.
 */
export function reprocessClip(db: Db, id: string): { ok: true } | { ok: false; error: string } {
  return db.transaction(() => {
    if (!db.select({ id: clips.id }).from(clips).where(eq(clips.id, id)).get()) {
      return { ok: false, error: "That clip is gone." } as const;
    }

    const active = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.clipId, id), inArray(jobs.status, ["queued", "running"])))
      .get();

    if (active) {
      return { ok: false, error: "This clip already has a job queued or running." } as const;
    }

    db.delete(jobs).where(eq(jobs.clipId, id)).run();
    db.update(clips).set({ status: "pending", errorMessage: null }).where(eq(clips.id, id)).run();
    enqueueJob(db, id, "probe");
    return { ok: true } as const;
  });
}
