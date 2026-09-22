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
