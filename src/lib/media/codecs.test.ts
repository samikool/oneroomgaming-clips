import { describe, expect, it } from "bun:test";
import { isBrowserPlayable } from "@/lib/media/codecs";

describe("isBrowserPlayable", () => {
  it("accepts h264 with aac", () => {
    expect(isBrowserPlayable("h264", "aac")).toBe(true);
  });

  it("accepts h264 with no audio track", () => {
    expect(isBrowserPlayable("h264", null)).toBe(true);
  });

  it("rejects hevc", () => {
    expect(isBrowserPlayable("hevc", "aac")).toBe(false);
  });

  it("accepts av1 with no pixel format known", () => {
    // This asserted rejection until real AV1 clips arrived and were stranded
    // in needs_transcode. See the av1 block below.
    expect(isBrowserPlayable("av1", "aac")).toBe(true);
  });

  it("rejects an unsupported audio codec alongside supported video", () => {
    expect(isBrowserPlayable("h264", "opus")).toBe(false);
  });

  it("rejects when the video codec is unknown", () => {
    expect(isBrowserPlayable(null, "aac")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBrowserPlayable("H264", "AAC")).toBe(true);
  });
});

describe("isBrowserPlayable — pixel format", () => {
  it("accepts the 8-bit 4:2:0 formats browsers actually decode", () => {
    expect(isBrowserPlayable("h264", "aac", "yuv420p")).toBe(true);
    expect(isBrowserPlayable("h264", "aac", "yuvj420p")).toBe(true);
  });

  it("rejects 4:4:4, which no browser decodes", () => {
    // H.264 High 4:4:4 Predictive. ffmpeg produces it happily from an RGB
    // source, the file probes as h264, and the player stays black.
    expect(isBrowserPlayable("h264", "aac", "yuv444p")).toBe(false);
    expect(isBrowserPlayable("h264", null, "yuv422p")).toBe(false);
  });

  it("rejects 10-bit, which some capture setups produce", () => {
    expect(isBrowserPlayable("h264", "aac", "yuv420p10le")).toBe(false);
  });

  it("stays permissive when the pixel format is unknown", () => {
    // `transcode` is registered but stubbed, so needs_transcode is a dead
    // end. Guessing a file is bad on absent evidence strands it there.
    expect(isBrowserPlayable("h264", "aac", null)).toBe(true);
    expect(isBrowserPlayable("h264", "aac")).toBe(true);
  });

  it("still rejects an unplayable codec whatever the pixel format", () => {
    expect(isBrowserPlayable("hevc", "aac", "yuv420p")).toBe(false);
  });
});

describe("isBrowserPlayable — av1", () => {
  it("accepts av1, which browsers have decoded for years", () => {
    // Chrome 70+, Firefox 67+, Safari 17+. Six real clips were rejected as
    // needs_transcode — a dead end, since transcode is a stub — because the
    // allowlist only named h264.
    expect(isBrowserPlayable("av1", "aac", "yuv420p")).toBe(true);
    expect(isBrowserPlayable("av01", "aac", "yuv420p")).toBe(true);
  });

  it("accepts 10-bit av1", () => {
    // AV1 Main profile covers 8- and 10-bit 4:2:0 and browsers decode both, so
    // the H.264 pixel-format rule must not be applied to it.
    expect(isBrowserPlayable("av1", "aac", "yuv420p10le")).toBe(true);
  });

  it("still rejects 10-bit h264, where the rule does apply", () => {
    expect(isBrowserPlayable("h264", "aac", "yuv420p10le")).toBe(false);
  });

  it("still rejects 4:4:4 whatever the codec", () => {
    expect(isBrowserPlayable("h264", "aac", "yuv444p")).toBe(false);
    expect(isBrowserPlayable("av1", "aac", "yuv444p")).toBe(false);
  });

  it("still rejects codecs browsers do not decode in mp4", () => {
    expect(isBrowserPlayable("hevc", "aac", "yuv420p")).toBe(false);
    expect(isBrowserPlayable("vp8", "aac", "yuv420p")).toBe(false);
  });
});
