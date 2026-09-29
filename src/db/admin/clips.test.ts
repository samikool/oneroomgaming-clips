import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, getClip, setClipStatus } from "@/db/clips";
import { claimNextJob, completeJob, enqueueJob, enqueueStage, failJob, MAX_ATTEMPTS } from "@/db/jobs";
import { setClipGame } from "@/db/metadata";
import { searchClipIds } from "@/db/search";
import { clips, jobs } from "@/db/schema";
import { ADMIN_PAGE_SIZE, listAdminClips, reprocessClip, updateClipTitle } from "./clips";

/** A clock past every retry backoff, so a test can exhaust a job at once. */
const pastBackoff = new Date(Date.now() + 24 * 60 * 60 * 1000);

let db: Db;
let sam: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
});

const make = (title: string, at = Date.now(), sizeBytes: number | null = 10) => {
  const clip = createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1, uploaderId: sam }, new Date(at));
  db.update(clips).set({ sizeBytes }).where(eq(clips.id, clip.id)).run();
  return clip.id;
};
const jobsFor = (clipId: string) => db.select().from(jobs).where(eq(jobs.clipId, clipId)).all();

/** A clip whose probe job spent every attempt: what the runner leaves behind. */
function failedClip(title = "broken"): string {
  const id = make(title);
  enqueueStage(db, id, "probe");
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const job = claimNextJob(db, pastBackoff)!;
    failJob(db, job.id, "ffprobe exploded");
  }
  setClipStatus(db, id, "failed", "ffprobe exploded");
  return id;
}

describe("listAdminClips", () => {
  it("lists newest first with uploader, game, size and error", () => {
    const old = make("old one", 1_000, null);
    const fresh = make("new one", 2_000, 2048);
    setClipGame(db, fresh, "Apex");
    setClipStatus(db, old, "failed", "boom");

    const { rows, total } = listAdminClips(db, {});
    expect(total).toBe(2);
    expect(rows.map((r) => r.id)).toEqual([fresh, old]);
    expect(rows[0]).toMatchObject({ title: "new one", uploader: "sam", game: "Apex", sizeBytes: 2048, createdAt: 2_000, errorMessage: null });
    expect(rows[1]).toMatchObject({ status: "failed", errorMessage: "boom", sizeBytes: null, game: null });
  });

  it("filters by status and by search, together", () => {
    const a = make("insane clutch", 1);
    const b = make("clutch again", 2);
    make("nothing", 3);
    setClipStatus(db, a, "ready");
    expect(listAdminClips(db, { status: "ready" }).rows.map((r) => r.id)).toEqual([a]);
    expect(listAdminClips(db, { q: "clutch" }).rows.map((r) => r.id)).toEqual([b, a]);
    expect(listAdminClips(db, { q: "clutch", status: "ready" })).toMatchObject({ total: 1 });
    expect(listAdminClips(db, { q: "zzzz" })).toEqual({ rows: [], total: 0 });
  });

  it("pages by the page size and reports the full total", () => {
    for (let i = 0; i < ADMIN_PAGE_SIZE + 3; i += 1) make(`c${i}`, i);
    const first = listAdminClips(db, { page: 0 });
    const second = listAdminClips(db, { page: 1 });
    expect(first.rows).toHaveLength(ADMIN_PAGE_SIZE);
    expect(second.rows).toHaveLength(3);
    expect(first.total).toBe(ADMIN_PAGE_SIZE + 3);
    expect(second.rows.at(-1)?.title).toBe("c0");
  });
});

describe("updateClipTitle", () => {
  it("saves a trimmed title and search finds it", () => {
    const id = make("old name");
    expect(updateClipTitle(db, id, "  Wild flank  ")).toEqual({ ok: true });
    expect(getClip(db, id)?.title).toBe("Wild flank");
    expect([...searchClipIds(db, "flank")!]).toEqual([id]);
    expect([...searchClipIds(db, "old")!]).toEqual([]);
  });

  it("rejects an empty or overlong title and leaves it alone", () => {
    const id = make("keep");
    expect(updateClipTitle(db, id, "   ")).toMatchObject({ ok: false });
    expect(updateClipTitle(db, id, "x".repeat(201))).toMatchObject({ ok: false });
    expect(getClip(db, id)?.title).toBe("keep");
  });
});

describe("reprocessClip", () => {
  it("re-queues a failed clip from the probe step and sets it pending", () => {
    const id = failedClip();
    expect(reprocessClip(db, id)).toEqual({ ok: true });
    expect(getClip(db, id)).toMatchObject({ status: "pending", errorMessage: null });
    expect(jobsFor(id).map((j) => [j.type, j.status, j.attempts])).toEqual([["probe", "queued", 0]]);
  });

  it("clears the old stages so the pipeline can enqueue its successors again", () => {
    const id = make("half done");
    const probe = enqueueStage(db, id, "probe");
    claimNextJob(db);
    completeJob(db, probe.id);
    const remux = enqueueStage(db, id, "remux");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) failJob(db, claimNextJob(db, pastBackoff)!.id, "remux died");
    setClipStatus(db, id, "failed", "remux died");

    expect(reprocessClip(db, id)).toEqual({ ok: true });
    // enqueueStage is single-use per (clip, type): a leftover remux row would stall the rerun.
    expect(enqueueStage(db, id, "remux").id).not.toBe(remux.id);
  });

  it("refuses while a job for the clip is queued, and adds no job", () => {
    const id = make("queued");
    enqueueJob(db, id, "probe");
    expect(reprocessClip(db, id)).toEqual({ ok: false, error: "This clip already has a job queued or running." });
    expect(jobsFor(id)).toHaveLength(1);
  });

  it("refuses while a job for the clip is running, and adds no job", () => {
    const id = make("running");
    enqueueJob(db, id, "probe");
    claimNextJob(db);
    expect(reprocessClip(db, id)).toMatchObject({ ok: false });
    expect(jobsFor(id).map((j) => j.status)).toEqual(["running"]);
  });

  it("refuses a clip that is gone", () => {
    expect(reprocessClip(db, "nope")).toMatchObject({ ok: false });
  });
});
