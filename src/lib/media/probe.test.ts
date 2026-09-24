import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeError, probeFile } from "@/lib/media/probe";

let dir: string;
let sample: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clips-probe-"));
  sample = join(dir, "sample.mp4");

  const proc = Bun.spawn([
    "ffmpeg", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sample,
  ]);
  await proc.exited;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("probeFile", () => {
  it("reads dimensions, codecs and duration from a real file", async () => {
    const info = await probeFile(sample);

    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(info.durationMs).toBeGreaterThan(500);
    expect(info.sizeBytes).toBeGreaterThan(0);
  });

  it("throws ProbeError for a file that is not media", async () => {
    const junk = join(dir, "junk.mp4");
    writeFileSync(junk, "not a video");

    expect(probeFile(junk)).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError for a missing file", async () => {
    expect(probeFile(join(dir, "nope.mp4"))).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError for a file with no video stream", async () => {
    const audioOnly = join(dir, "audio-only.m4a");
    const proc = Bun.spawn([
      "ffmpeg", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t", "1", "-c:a", "aac", audioOnly,
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;

    expect(probeFile(audioOnly)).rejects.toThrow(ProbeError);
  });
});
