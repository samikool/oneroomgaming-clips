import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { jobs, type Job, type JobType } from "./schema";

export const MAX_ATTEMPTS = 3;

export function enqueueJob(
  db: Db,
  clipId: string,
  type: JobType,
  now: Date = new Date(),
): Job {
  return db
    .insert(jobs)
    .values({
      id: ulid(),
      clipId,
      type,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    })
    .returning()
    .get();
}

// Pipeline stages are single-use. Retrying a stage after a restart must not
// create a second copy of its successor, even if that successor already ran.
export function enqueueStage(db: Db, clipId: string, type: JobType): Job {
  return db.select().from(jobs)
    .where(and(eq(jobs.clipId, clipId), eq(jobs.type, type))).get()
    ?? enqueueJob(db, clipId, type);
}

export function claimNextJob(db: Db, now: Date = new Date()): Job | undefined {
  const next = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt))
    .limit(1)
    .get();

  if (!next) {
    return undefined;
  }

  return db
    .update(jobs)
    .set({ status: "running", attempts: next.attempts + 1, startedAt: now })
    .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
    .returning()
    .get();
}

export function completeJob(db: Db, id: string, now: Date = new Date()): void {
  db.update(jobs)
    .set({ status: "done", finishedAt: now, lastError: null })
    .where(eq(jobs.id, id))
    .run();
}

export function failJob(
  db: Db,
  id: string,
  error: string,
  now: Date = new Date(),
): void {
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();

  if (!job) {
    return;
  }

  const exhausted = job.attempts >= MAX_ATTEMPTS;

  db.update(jobs)
    .set({
      status: exhausted ? "failed" : "queued",
      lastError: error,
      finishedAt: exhausted ? now : null,
    })
    .where(eq(jobs.id, id))
    .run();
}

/** Single web worker: jobs left running by a stopped process can be retried. */
export function recoverRunningJobs(db: Db): void {
  for (const job of db.select().from(jobs).where(eq(jobs.status, "running")).all()) {
    // A restart is not a processing failure; preserve the retry budget.
    db.update(jobs).set({ status: "queued", attempts: Math.max(0, job.attempts - 1), startedAt: null })
      .where(eq(jobs.id, job.id)).run();
  }
}
