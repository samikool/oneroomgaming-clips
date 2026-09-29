import { beforeEach, describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { createDb, type Db } from "@/db/client";
import { clips, jobs } from "@/db/schema";
import { claimNextJob, completeJob, enqueueJob, failJob, recoverRunningJobs, enqueueStage, MAX_ATTEMPTS, RETRY_DELAYS_MS } from "@/db/jobs";

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
    // Far enough ahead that every backoff has elapsed.
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      claimNextJob(db, later);
      failJob(db, job.id, "boom");

      // Pin the boundary from BOTH sides. Asserting only the end state cannot
      // tell a correct cap from one that trips a cycle early: an early
      // implementation would fail the job sooner, the remaining iterations
      // would no-op, and the final assertions would still pass.
      const expected = i < MAX_ATTEMPTS - 1 ? "queued" : "failed";
      expect(db.select().from(jobs).get()?.status).toBe(expected);
    }

    expect(claimNextJob(db, later)).toBeUndefined();
  });
});

describe("retry backoff", () => {
  const t0 = new Date("2026-09-29T00:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("holds a failed job back for the next delay instead of retrying at once", () => {
    const job = enqueueJob(db, clipId, "probe", t0);
    claimNextJob(db, t0);
    failJob(db, job.id, "boom", t0);

    expect(db.select().from(jobs).get()?.runAfter?.getTime()).toBe(at(RETRY_DELAYS_MS[0]).getTime());
    expect(claimNextJob(db, at(RETRY_DELAYS_MS[0] - 1))).toBeUndefined();
    expect(claimNextJob(db, at(RETRY_DELAYS_MS[0]))?.id).toBe(job.id);
  });

  it("waits longer after each failure", () => {
    const job = enqueueJob(db, clipId, "probe", t0);
    claimNextJob(db, t0);
    failJob(db, job.id, "boom", t0);
    const second = at(RETRY_DELAYS_MS[0]);
    claimNextJob(db, second);
    failJob(db, job.id, "boom", second);

    expect(RETRY_DELAYS_MS[1]).toBeGreaterThan(RETRY_DELAYS_MS[0]);
    expect(db.select().from(jobs).get()?.runAfter?.getTime()).toBe(second.getTime() + RETRY_DELAYS_MS[1]);
  });

  it("does not let a waiting job block other work", () => {
    const waiting = enqueueJob(db, clipId, "probe", t0);
    claimNextJob(db, t0);
    failJob(db, waiting.id, "boom", t0);
    const fresh = enqueueJob(db, clipId, "thumbnail", at(1));

    expect(claimNextJob(db, at(2))?.id).toBe(fresh.id);
  });

  it("has a delay for every retry", () => {
    expect(RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(MAX_ATTEMPTS - 1);
  });
});

describe("restart recovery", () => {
  it("reclaims interrupted jobs without consuming the retry budget", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    recoverRunningJobs(db);
    const retried = claimNextJob(db);
    expect(retried?.id).toBe(job.id);
    expect(retried?.attempts).toBe(1);
  });
  it("does not duplicate the next stage after its predecessor is retried", () => {
    const job = enqueueStage(db, clipId, "thumbnail");
    completeJob(db, job.id);
    expect(enqueueStage(db, clipId, "thumbnail").id).toBe(job.id);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });
});
