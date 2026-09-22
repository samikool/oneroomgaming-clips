import { beforeEach, describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { createDb, type Db } from "@/db/client";
import { clips, jobs } from "@/db/schema";
import { claimNextJob, completeJob, enqueueJob, failJob, MAX_ATTEMPTS } from "@/db/jobs";

let db: Db;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  clipId = ulid();
  db.insert(clips).values({
    id: clipId, title: "t", originalFilename: "t.mp4", uploaderId: null,
    gameId: null, status: "pending", durationMs: null, width: null, height: null,
    videoCodec: null, audioCodec: null, sizeBytes: 1, recordedAt: null,
    thumbPath: null, errorMessage: null, createdAt: new Date(),
  }).run();
});

describe("job queue", () => {
  it("enqueues a queued job", () => {
    const job = enqueueJob(db, clipId, "probe");
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
  });

  it("claims the oldest queued job and marks it running", () => {
    const first = enqueueJob(db, clipId, "probe", new Date("2026-01-01"));
    enqueueJob(db, clipId, "thumbnail", new Date("2026-01-02"));

    const claimed = claimNextJob(db);
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("does not hand the same job to a second claim", () => {
    enqueueJob(db, clipId, "probe");
    claimNextJob(db);

    expect(claimNextJob(db)).toBeUndefined();
  });

  it("returns undefined when nothing is queued", () => {
    expect(claimNextJob(db)).toBeUndefined();
  });

  it("marks a job done", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    completeJob(db, job.id);

    expect(db.select().from(jobs).get()?.status).toBe("done");
  });

  it("requeues a failed job so it can be retried", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    failJob(db, job.id, "boom");

    const row = db.select().from(jobs).get();
    expect(row?.status).toBe("queued");
    expect(row?.lastError).toBe("boom");
  });

  it("gives up after MAX_ATTEMPTS instead of retrying forever", () => {
    const job = enqueueJob(db, clipId, "probe");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      claimNextJob(db);
      failJob(db, job.id, "boom");

      // Pin the boundary from BOTH sides. Asserting only the end state cannot
      // tell a correct cap from one that trips a cycle early: an early
      // implementation would fail the job sooner, the remaining iterations
      // would no-op, and the final assertions would still pass.
      const expected = i < MAX_ATTEMPTS - 1 ? "queued" : "failed";
      expect(db.select().from(jobs).get()?.status).toBe(expected);
    }

    expect(claimNextJob(db)).toBeUndefined();
  });
});
