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
    "-c:v", "libx264", "-pix_fmt", "yuv420p", ...extraArgs, path,
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

describe("probe handler (unsupported codec)", () => {
  it("marks the clip needs_transcode and removes the incoming source", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input, ["-c:v", "mpeg4"]);

    const job = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, job);

    const updated = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(updated?.status).toBe("needs_transcode");

    // A clip that never reaches `thumbnail` must still have its pre-publish
    // source bytes cleaned up, not left to leak forever.
    expect(existsSync(input)).toBe(false);
  });
});

describe("remux handler", () => {
  it("produces a faststart clip, retains the incoming file until the pipeline completes, and queues a thumbnail", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);

    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);

    expect(existsSync(join(root, "clips", `${clip.id}.mp4`))).toBe(true);
    expect(existsSync(input)).toBe(true);

    const queued = db.select().from(jobsTable).where(eq(jobsTable.status, "queued")).all();
    expect(queued.map((j) => j.type)).toContain("thumbnail");
  });
});

describe("remux handler (OBS replay clip with a hidden lead-in)", () => {
  // OBS writes frames back to the previous keyframe and hides them behind an
  // edit list. Players must decode that lead-in before the first visible
  // frame, and software decoders visibly freeze doing it. The remux turns the
  // lead-in into ordinary footage instead.

  async function ffmpeg(args: string[]) {
    const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", ...args], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  }

  async function firstVideoPacket(path: string): Promise<string> {
    const proc = Bun.spawn([
      "ffprobe", "-v", "error", "-select_streams", "v:0",
      "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path,
    ], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.split("\n")[0].trim();
  }

  it("starts the stored clip on a visible keyframe at zero, lead-in included", async () => {
    const clip = createClip(db, { title: "obs", originalFilename: "obs.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    const full = join(root, `${clip.id}-full.mp4`);

    await ffmpeg([
      "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=30",
      "-f", "lavfi", "-i", "sine=duration=4:sample_rate=48000",
      "-c:v", "libx264", "-g", "60", "-bf", "0", "-pix_fmt", "yuv420p",
      "-c:a", "aac", full,
    ]);
    await ffmpeg(["-ss", "1.2", "-i", full, "-c", "copy", input]);

    // The fixture must actually have the hidden lead-in, or this proves nothing.
    expect(await firstVideoPacket(input)).toMatch(/^-1\.2\d*,K/);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);
    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);

    const output = join(root, "clips", `${clip.id}.mp4`);
    const [pts, flags] = (await firstVideoPacket(output)).split(",");
    expect(Number(pts)).toBeGreaterThanOrEqual(0);
    expect(Number(pts)).toBeLessThan(0.05);
    expect(flags.startsWith("K")).toBe(true);

    // The stored duration grows by the lead-in: 2.8s visible + 1.2s lead-in.
    const updated = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(updated?.durationMs).toBeGreaterThan(3800);
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

describe("probe handler (unplayable pixel format)", () => {
  it("marks a 4:4:4 clip needs_transcode even though it is h264", () => {
    // This is not hypothetical: three clips generated exactly this way sat in
    // the dev library marked `ready` and showed a black player.
    return (async () => {
      const clip = createClip(db, {
        id: "01PIXFMT",
        title: "4:4:4",
        originalFilename: "444.mp4",
        sizeBytes: 1,
      });
      await makeSample(join(root, "incoming", "01PIXFMT.mp4"), ["-pix_fmt", "yuv444p"]);
      enqueueJob(db, clip.id, "probe");
      const job = claimNextJob(db)!;

      await handlers.probe({ db, env }, job);

      const updated = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
      expect(updated?.videoCodec).toBe("h264");
      expect(updated?.status).toBe("needs_transcode");
    })();
  });
});
