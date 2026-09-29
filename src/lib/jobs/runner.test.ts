import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip, getClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import { jobs as jobsTable } from "@/db/schema";
import { runOnce, startRunner } from "@/lib/jobs/runner";

let db: Db;

/** Attempt `i`'s clock: a day apart, so every backoff before it has elapsed. */
const afterBackoff = (i: number) => new Date(Date.now() + i * 24 * 60 * 60 * 1000);

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
      expect(await runOnce({ db, env: {} }, afterBackoff(i))).toBe(true);
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
    expect(await runOnce({ db, env: {} }, afterBackoff(0))).toBe(true);
    expect(getClip(db, clip.id)?.status).not.toBe("failed");

    // Exhaust the remaining attempts; only now is the clip truly stuck.
    expect(await runOnce({ db, env: {} }, afterBackoff(1))).toBe(true);
    expect(await runOnce({ db, env: {} }, afterBackoff(2))).toBe(true);
    expect(getClip(db, clip.id)?.status).toBe("failed");
  });

  it("tells the clip it is retrying while a retry is still coming", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    await runOnce({ db, env: {} }, afterBackoff(0));

    const row = getClip(db, clip.id);
    expect(row?.status).toBe("retrying");
    expect(row?.errorMessage).toContain("not implemented");
  });

  it("does not retry before the backoff has elapsed", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");
    const t0 = afterBackoff(0);

    await runOnce({ db, env: {} }, t0);

    expect(await runOnce({ db, env: {} }, t0)).toBe(false);
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

describe("job.updated", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("announces each status change of a job to the admin panel", async () => {
    const sent: { t: string; job?: { status: string; attempts: number; clipTitle: string | null } }[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const env = { REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s" };
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    await runOnce({ db, env });
    await Bun.sleep(0);

    const jobs = sent.filter((m) => m.t === "job.updated").map((m) => [m.job!.status, m.job!.attempts, m.job!.clipTitle]);
    // Claimed, then back in the queue with retries left.
    expect(jobs).toEqual([
      ["running", 1, "a"],
      ["queued", 1, "a"],
    ]);
  });
});
