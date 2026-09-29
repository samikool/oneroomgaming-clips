import { describe, expect, it } from "bun:test";
import { isPlayableAudio, isPlayableVideo } from "@/lib/media/codecs";

describe("isPlayableVideo", () => {
  it("accepts h264", () => {
    expect(isPlayableVideo("h264")).toBe(true);
  });

  it("rejects hevc", () => {
    expect(isPlayableVideo("hevc")).toBe(false);
  });

  it("accepts av1 with no pixel format known", () => {
    // This asserted rejection until real AV1 clips arrived and were stranded
    // in needs_transcode. See the av1 block below.
    expect(isPlayableVideo("av1")).toBe(true);
  });

  it("rejects when the video codec is unknown", () => {
    expect(isPlayableVideo(null)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPlayableVideo("H264")).toBe(true);
  });
});

describe("isPlayableVideo — pixel format", () => {
  it("accepts the 8-bit 4:2:0 formats browsers actually decode", () => {
    expect(isPlayableVideo("h264", "yuv420p")).toBe(true);
    expect(isPlayableVideo("h264", "yuvj420p")).toBe(true);
  });

  it("rejects 4:4:4, which no browser decodes", () => {
    // H.264 High 4:4:4 Predictive. ffmpeg produces it happily from an RGB
    // source, the file probes as h264, and the player stays black.
    expect(isPlayableVideo("h264", "yuv444p")).toBe(false);
    expect(isPlayableVideo("h264", "yuv422p")).toBe(false);
  });

  it("rejects 10-bit, which some capture setups produce", () => {
    expect(isPlayableVideo("h264", "yuv420p10le")).toBe(false);
  });

  it("stays permissive when the pixel format is unknown", () => {
    // `transcode` is registered but stubbed, so needs_transcode is a dead
    // end. Guessing a file is bad on absent evidence strands it there.
    expect(isPlayableVideo("h264", null)).toBe(true);
    expect(isPlayableVideo("h264")).toBe(true);
  });

  it("still rejects an unplayable codec whatever the pixel format", () => {
    expect(isPlayableVideo("hevc", "yuv420p")).toBe(false);
  });
});

describe("isPlayableVideo — av1", () => {
  it("accepts av1, which browsers have decoded for years", () => {
    // Chrome 70+, Firefox 67+, Safari 17+. Six real clips were rejected as
    // needs_transcode — a dead end, since transcode is a stub — because the
    // allowlist only named h264.
    expect(isPlayableVideo("av1", "yuv420p")).toBe(true);
    expect(isPlayableVideo("av01", "yuv420p")).toBe(true);
  });

  it("accepts 10-bit av1", () => {
    // AV1 Main profile covers 8- and 10-bit 4:2:0 and browsers decode both, so
    // the H.264 pixel-format rule must not be applied to it.
    expect(isPlayableVideo("av1", "yuv420p10le")).toBe(true);
  });

  it("still rejects 10-bit h264, where the rule does apply", () => {
    expect(isPlayableVideo("h264", "yuv420p10le")).toBe(false);
  });

  it("still rejects 4:4:4 whatever the codec", () => {
    expect(isPlayableVideo("h264", "yuv444p")).toBe(false);
    expect(isPlayableVideo("av1", "yuv444p")).toBe(false);
  });
});

describe("isPlayableVideo — vp9", () => {
  it("accepts 8-bit 4:2:0 vp9, copied into the mp4 as it is", () => {
    // 18 League clips from the old shared folder are VP9 WebM. The video
    // needs no re-encode; only their Vorbis audio has to change.
    expect(isPlayableVideo("vp9", "yuv420p")).toBe(true);
  });

  it("rejects vp9 in anything but 8-bit 4:2:0", () => {
    expect(isPlayableVideo("vp9", "yuv444p")).toBe(false);
    expect(isPlayableVideo("vp9", "yuv420p10le")).toBe(false);
  });

  it("rejects vp8, which mp4 cannot hold", () => {
    expect(isPlayableVideo("vp8", "yuv420p")).toBe(false);
  });
});

describe("isPlayableAudio", () => {
  it("accepts aac and mp3", () => {
    expect(isPlayableAudio("aac")).toBe(true);
    expect(isPlayableAudio("MP3")).toBe(true);
  });

  it("accepts no audio track", () => {
    expect(isPlayableAudio(null)).toBe(true);
  });

  it("rejects what the remux converts to aac", () => {
    expect(isPlayableAudio("vorbis")).toBe(false);
    expect(isPlayableAudio("opus")).toBe(false);
    expect(isPlayableAudio("pcm_s16le")).toBe(false);
  });
});
