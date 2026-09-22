import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
