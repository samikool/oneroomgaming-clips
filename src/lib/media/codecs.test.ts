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

  it("rejects av1", () => {
    expect(isBrowserPlayable("av1", "aac")).toBe(false);
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
