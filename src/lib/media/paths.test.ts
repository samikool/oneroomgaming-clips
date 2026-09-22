import { describe, expect, it } from "bun:test";
import {
  clipFilename, clipPublicPath, clipsDir, incomingDir,
  mediaRoot, thumbFilename, thumbPublicPath, thumbsDir,
} from "@/lib/media/paths";

describe("media paths", () => {
  it("uses MEDIA_ROOT when set", () => {
    expect(mediaRoot({ MEDIA_ROOT: "/media" })).toBe("/media");
  });

  it("falls back to a local directory when MEDIA_ROOT is absent", () => {
    expect(mediaRoot({})).toBe("./data/media");
  });

  it("derives the three subdirectories from the root", () => {
    const env = { MEDIA_ROOT: "/media" };
    expect(incomingDir(env)).toBe("/media/incoming");
    expect(clipsDir(env)).toBe("/media/clips");
    expect(thumbsDir(env)).toBe("/media/thumbs");
  });

  it("builds opaque filenames from the clip id", () => {
    expect(clipFilename("01ABC")).toBe("01ABC.mp4");
    expect(thumbFilename("01ABC")).toBe("01ABC.jpg");
  });

  it("builds public paths matching the deployed Caddy routes", () => {
    expect(clipPublicPath("01ABC")).toBe("/media/clips/01ABC.mp4");
    expect(thumbPublicPath("01ABC")).toBe("/media/thumbs/01ABC.jpg");
  });
});
