import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { claimNextJob, enqueueJob } from "@/db/jobs";
import { clips as clipsTable, jobs as jobsTable } from "@/db/schema";
import { handlers, NotImplementedError } from "@/lib/jobs/handlers";
import { eq } from "drizzle-orm";

let root: string;
let env: Partial<NodeJS.ProcessEnv>;
let db: Db;

async function makeSample(path: string, extraArgs: string[] = []) {
  const proc = Bun.spawn([
    "ffmpeg", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-c:v", "libx264", ...extraArgs, path,
  ], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "clips-handlers-"));
  mkdirSync(join(root, "incoming"), { recursive: true });
  env = { MEDIA_ROOT: root };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  db = createDb(":memory:");
});

describe("probe handler", () => {
  it("writes media info and enqueues remux for a playable clip", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const job = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, job);

    const updated = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(updated?.width).toBe(320);
    expect(updated?.videoCodec).toBe("h264");
    expect(updated?.status).toBe("processing");

    const queued = db.select().from(jobsTable).where(eq(jobsTable.status, "queued")).all();
    expect(queued.map((j) => j.type)).toContain("remux");
  });
});

describe("remux handler", () => {
  it("produces a faststart clip, removes the incoming file, and queues a thumbnail", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);

    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);

    expect(existsSync(join(root, "clips", `${clip.id}.mp4`))).toBe(true);
    expect(existsSync(input)).toBe(false);

    const queued = db.select().from(jobsTable).where(eq(jobsTable.status, "queued")).all();
    expect(queued.map((j) => j.type)).toContain("thumbnail");
  });
});

describe("thumbnail handler", () => {
  it("writes a thumbnail and marks the clip ready", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);
    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);
    const thumbJob = db.select().from(jobsTable).where(eq(jobsTable.type, "thumbnail")).get()!;
    await handlers.thumbnail({ db, env }, thumbJob);

    expect(existsSync(join(root, "thumbs", `${clip.id}.jpg`))).toBe(true);

    const final = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(final?.status).toBe("ready");
    expect(final?.thumbPath).toBe(`/media/thumbs/${clip.id}.jpg`);
  });
});

describe("transcode handler", () => {
  it("is registered but not implemented", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const job = enqueueJob(db, clip.id, "transcode");

    expect(handlers.transcode({ db, env }, job)).rejects.toThrow(NotImplementedError);
  });
});
