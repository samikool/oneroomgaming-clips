import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransformError, extractThumbnail, remuxFaststart } from "@/lib/media/transform";

let dir: string;
let sample: string;

async function run(args: string[]) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clips-transform-"));
  sample = join(dir, "sample.mp4");
  await run([
    "ffmpeg", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-c:v", "libx264", sample,
  ]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The moov atom sits at the front of a faststart file. */
function moovIsNearFront(path: string): boolean {
  const buf = readFileSync(path);
  const moov = buf.indexOf(Buffer.from("moov"));
  const mdat = buf.indexOf(Buffer.from("mdat"));
  return moov !== -1 && mdat !== -1 && moov < mdat;
}

describe("remuxFaststart", () => {
  it("moves the moov atom ahead of the media data", async () => {
    const out = join(dir, "fast.mp4");
    await remuxFaststart(sample, out);

    expect(statSync(out).size).toBeGreaterThan(0);
    expect(moovIsNearFront(out)).toBe(true);
  });

  it("throws TransformError on a file that is not media", async () => {
    const junk = join(dir, "junk.mp4");
    await Bun.write(junk, "not a video");

    expect(remuxFaststart(junk, join(dir, "out.mp4"))).rejects.toThrow(TransformError);
  });
});

describe("extractThumbnail", () => {
  it("writes a non-empty jpeg", async () => {
    const out = join(dir, "thumb.jpg");
    await extractThumbnail(sample, out, 1);

    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it("still produces a thumbnail when the seek point is past the end", async () => {
    const out = join(dir, "thumb-late.jpg");
    await extractThumbnail(sample, out, 9999);

    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it("throws when the input is not media, rather than silently falling back", async () => {
    const junk = join(dir, "junk-thumb.mp4");
    await Bun.write(junk, "not a video");

    expect(extractThumbnail(junk, join(dir, "junk-thumb.jpg"))).rejects.toThrow(TransformError);
  });
});

describe("extractThumbnail — an ffmpeg that succeeds without writing", () => {
  // The bug this covers: ffmpeg 6 exits 0 on a past-the-end seek and merely
  // warns "Nothing was written into output file", where ffmpeg 8 exits
  // non-zero. Trusting the exit code meant the fallback never ran on 6, the
  // clip got no thumbnail, and the grid rendered a broken image against a
  // thumb_path that pointed at nothing.

  it("falls back when the seek attempt exits 0 but leaves no file", async () => {
    const out = join(dir, "silent-fallback.jpg");
    const calls: string[][] = [];

    await extractThumbnail(sample, out, 9999, async (_action, _input, args) => {
      calls.push(args);

      // First call is the seek; pretend it "succeeded" and wrote nothing.
      if (calls.length === 1) {
        return;
      }

      await run(["ffmpeg", "-loglevel", "error", "-y", ...args]);
    });

    expect(calls).toHaveLength(2);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it("throws rather than reporting success when no attempt writes a file", async () => {
    // Returning quietly here is what records a thumb_path for a file that
    // does not exist.
    const out = join(dir, "never-written.jpg");

    await expect(
      extractThumbnail(sample, out, 9999, async () => {}),
    ).rejects.toThrow(TransformError);
  });

  it("treats a zero-byte output as no output", async () => {
    const out = join(dir, "empty-output.jpg");

    await expect(
      extractThumbnail(sample, out, 1, async () => {
        writeFileSync(out, "");
      }),
    ).rejects.toThrow(TransformError);
  });
});

describe("remuxFaststart — an ffmpeg that succeeds without writing", () => {
  it("throws rather than reporting success", async () => {
    // Same defect, worse consequence: a clip row pointing at a file that was
    // never written 404s on playback.
    const out = join(dir, "remux-never-written.mp4");

    await expect(remuxFaststart(sample, out, async () => {})).rejects.toThrow(TransformError);
  });
});
