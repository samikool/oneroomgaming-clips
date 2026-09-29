import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { createClip, getClip, setClipStatus } from "@/db/clips";
import { claimNextJob, completeJob, enqueueJob, failJob, MAX_ATTEMPTS } from "@/db/jobs";
import { jobs } from "@/db/schema";
import { cancelJob, getAdminJob, listJobs, retryJob } from "./jobs";

/** A clock past every retry backoff, so a test can exhaust a job at once. */
const pastBackoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

let db: Db;
let clipId: string;
const DAY = 86_400_000;

beforeEach(() => {
  db = createDb(":memory:");
  clipId = createClip(db, { title: "the clip", originalFilename: "a.mp4", sizeBytes: 1 }).id;
});

const row = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;

function exhausted(): string {
  const job = enqueueJob(db, clipId, "probe");
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) failJob(db, claimNextJob(db, pastBackoff)!.id, "boom");
  return job.id;
}

describe("retryJob", () => {
  it("puts a failed job back in the queue, attempts untouched", () => {
    const id = exhausted();
    expect(retryJob(db, id)).toBe(true);
    expect(row(id)).toMatchObject({ status: "queued", attempts: MAX_ATTEMPTS, finishedAt: null });
  });

  it("refuses anything that is not failed", () => {
    const queued = enqueueJob(db, clipId, "probe");
    expect(retryJob(db, queued.id)).toBe(false);
    claimNextJob(db);
    expect(retryJob(db, queued.id)).toBe(false);
    completeJob(db, queued.id);
    expect(retryJob(db, queued.id)).toBe(false);
    expect(row(queued.id).status).toBe("done");
    expect(retryJob(db, "missing")).toBe(false);
  });
});

describe("cancelJob", () => {
  it("fails a queued job as cancelled by admin, and the clip with it", () => {
    const job = enqueueJob(db, clipId, "probe");
    expect(cancelJob(db, job.id)).toBe(true);
    expect(row(job.id)).toMatchObject({ status: "failed", lastError: "cancelled by admin" });
    expect(row(job.id).finishedAt).not.toBeNull();
    expect(getClip(db, clipId)).toMatchObject({ status: "failed", errorMessage: "cancelled by admin" });
  });

  it("leaves a ready clip's status alone", () => {
    setClipStatus(db, clipId, "ready");
    const job = enqueueJob(db, clipId, "thumbnail");
    expect(cancelJob(db, job.id)).toBe(true);
    expect(getClip(db, clipId)?.status).toBe("ready");
  });

  it("can't cancel a running, done or failed job", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    expect(cancelJob(db, job.id)).toBe(false);
    expect(row(job.id).status).toBe("running");
    completeJob(db, job.id);
    expect(cancelJob(db, job.id)).toBe(false);
    expect(cancelJob(db, exhausted())).toBe(false);
  });
});

describe("listJobs", () => {
  it("filters by status, keeps only the last day of done jobs, newest first", () => {
    const now = Date.now();
    const oldDone = enqueueJob(db, clipId, "probe", new Date(now - 3 * DAY));
    claimNextJob(db, new Date(now - 3 * DAY));
    completeJob(db, oldDone.id, new Date(now - 3 * DAY));
    const newDone = enqueueJob(db, clipId, "remux", new Date(now - 1000));
    claimNextJob(db);
    completeJob(db, newDone.id);
    const queued = enqueueJob(db, clipId, "thumbnail", new Date(now));

    const since = now - DAY;
    expect(listJobs(db, { sinceMs: since }).map((j) => j.id)).toEqual([queued.id, newDone.id]);
    expect(listJobs(db, { status: "done", sinceMs: since }).map((j) => j.id)).toEqual([newDone.id]);
    expect(listJobs(db, { status: "queued", sinceMs: since })).toEqual([
      expect.objectContaining({ id: queued.id, clipId, clipTitle: "the clip", type: "thumbnail", status: "queued", attempts: 0 }),
    ]);
  });

  it("getAdminJob carries the clip title and millisecond times", () => {
    const job = enqueueJob(db, clipId, "probe", new Date(5_000));
    expect(getAdminJob(db, job.id)).toEqual({
      id: job.id,
      clipId,
      clipTitle: "the clip",
      type: "probe",
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: 5_000,
      startedAt: null,
      finishedAt: null,
    });
    expect(getAdminJob(db, "missing")).toBeNull();
  });
});
