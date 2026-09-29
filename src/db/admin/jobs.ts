import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { clips, jobs, type JobStatus } from "@/db/schema";
import type { AdminJob } from "@/lib/realtime/envelope";

export type { AdminJob };

export const CANCELLED = "cancelled by admin";
const LIST_LIMIT = 200;

const columns = {
  id: jobs.id,
  clipId: jobs.clipId,
  clipTitle: clips.title,
  type: jobs.type,
  status: jobs.status,
  attempts: jobs.attempts,
  lastError: jobs.lastError,
  createdAt: jobs.createdAt,
  startedAt: jobs.startedAt,
  finishedAt: jobs.finishedAt,
};

type Row = {
  id: string;
  clipId: string;
  clipTitle: string | null;
  type: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function toAdminJob(row: Row): AdminJob {
  return {
    id: row.id,
    clipId: row.clipId,
    clipTitle: row.clipTitle,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    // A Date would arrive as a string on the far side of JSON.
    createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
  };
}

/** One job, as `job.updated` carries it, or null when it's gone. */
export function getAdminJob(db: Db, id: string): AdminJob | null {
  const row = db.select(columns).from(jobs).leftJoin(clips, eq(clips.id, jobs.clipId)).where(eq(jobs.id, id)).get();
  return row ? toAdminJob(row as Row) : null;
}

/**
 * The queue, newest first. Done jobs pile up forever, so only those finished
 * since `sinceMs` are listed; everything else is listed whatever its age.
 */
export function listJobs(db: Db, { status, sinceMs }: { status?: JobStatus; sinceMs: number }): AdminJob[] {
  const since = new Date(sinceMs);
  const recentDone = and(eq(jobs.status, "done"), gte(jobs.finishedAt, since));
  const where =
    status === "done" ? recentDone : status ? eq(jobs.status, status) : or(ne(jobs.status, "done"), recentDone);

  return db
    .select(columns)
    .from(jobs)
    .leftJoin(clips, eq(clips.id, jobs.clipId))
    .where(where)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(LIST_LIMIT)
    .all()
    .map((row) => toAdminJob(row as Row));
}

/** A failed job back to the queue, attempts left as they are. False for any other status. */
export function retryJob(db: Db, id: string): boolean {
  const row = db
    .update(jobs)
    .set({ status: "queued", finishedAt: null, startedAt: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
    .returning({ id: jobs.id })
    .get();

  return row !== undefined;
}

/**
 * A queued job to failed, "cancelled by admin". A running job can't be
 * cancelled: its handler is already doing the work.
 *
 * The clip goes to failed too when it hadn't finished, so it shows its
 * reason and a Reprocess button instead of "processing" forever.
 */
export function cancelJob(db: Db, id: string, now: Date = new Date()): boolean {
  return db.transaction(() => {
    const row = db
      .update(jobs)
      .set({ status: "failed", lastError: CANCELLED, finishedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.status, "queued")))
      .returning({ clipId: jobs.clipId })
      .get();

    if (!row) {
      return false;
    }

    db.update(clips)
      .set({ status: "failed", errorMessage: CANCELLED })
      .where(and(eq(clips.id, row.clipId), inArray(clips.status, ["pending", "processing", "retrying"])))
      .run();

    return true;
  });
}
