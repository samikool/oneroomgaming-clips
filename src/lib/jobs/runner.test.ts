import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip, getClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import { jobs as jobsTable } from "@/db/schema";
import { runOnce, startRunner } from "@/lib/jobs/runner";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("runOnce", () => {
  it("returns false when the queue is empty", async () => {
    expect(await runOnce({ db, env: {} })).toBe(false);
  });

  it("marks a job failed after exhausting attempts", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    for (let i = 0; i < 3; i += 1) {
      expect(await runOnce({ db, env: {} })).toBe(true);
    }

    const job = db.select().from(jobsTable).get();
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toContain("not implemented");
  });

  it("does not mark the clip failed while the job still has retries left", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    // First attempt of 3: the job is requeued, not permanently failed. The
    // clip must not be told it's failed while a retry is still coming.
    expect(await runOnce({ db, env: {} })).toBe(true);
    expect(getClip(db, clip.id)?.status).not.toBe("failed");

    // Exhaust the remaining attempts; only now is the clip truly stuck.
    expect(await runOnce({ db, env: {} })).toBe(true);
    expect(await runOnce({ db, env: {} })).toBe(true);
    expect(getClip(db, clip.id)?.status).toBe("failed");
  });

  it("does not throw when a handler throws", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    expect(runOnce({ db, env: {} })).resolves.toBe(true);
  });
});

describe("startRunner", () => {
  it("drains the whole queue rather than one job per tick", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");
    enqueueJob(db, clip.id, "transcode");

    const stop = startRunner({ db, env: {} }, 10_000);
    await Bun.sleep(150);
    stop();

    // Both jobs were attempted on the first tick, not one per interval.
    const attempted = db.select().from(jobsTable).all();
    expect(attempted.every((j) => j.attempts > 0)).toBe(true);
  });

  it("stops scheduling once stopped", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });

    const stop = startRunner({ db, env: {} }, 20);
    await Bun.sleep(60);
    stop();

    enqueueJob(db, clip.id, "transcode");
    await Bun.sleep(120);

    // A stopped runner must not pick up work enqueued afterwards.
    expect(db.select().from(jobsTable).get()?.attempts).toBe(0);
  });
});
