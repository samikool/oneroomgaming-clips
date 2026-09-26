import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type TrackEditList, hasObsLeadIn, readEditLists, shouldStripLeadIn,
} from "@/lib/media/editlist";

function video(entries: [mediaTime: number, segmentDuration: number][], timescale = 60000): TrackEditList {
  return {
    kind: "video",
    timescale,
    entries: entries.map(([mediaTime, segmentDuration]) => ({ mediaTime, segmentDuration })),
  };
}

function audio(entries: [mediaTime: number, segmentDuration: number][], timescale = 48000): TrackEditList {
  return { ...video(entries, timescale), kind: "audio" };
}

describe("shouldStripLeadIn", () => {
  it("strips an OBS replay clip: single-entry video and audio trims that agree", () => {
    // The real edit lists from an OBS replay-buffer clip: 2.787s and 2.797s.
    expect(shouldStripLeadIn([video([[167219, 1200147]]), audio([[134272, 960384]])])).toBe(true);
  });

  it("leaves a file with no edit lists alone", () => {
    expect(shouldStripLeadIn([video([]), audio([])])).toBe(false);
  });

  it("leaves a file with no tracks alone (not MP4, or no moov)", () => {
    expect(shouldStripLeadIn([])).toBe(false);
  });

  it("leaves trims more than 50ms apart alone, since ignoring them would shift A/V sync", () => {
    // 2.787s video vs 2.900s audio.
    expect(shouldStripLeadIn([video([[167219, 1200147]]), audio([[139200, 960384]])])).toBe(false);
  });

  it("leaves a trimmed video with an untrimmed audio track alone", () => {
    // No audio edit list means audio starts at media time 0 while video starts
    // at 2.787s; ignoring the video's edit list would put the audio 2.8s late.
    expect(shouldStripLeadIn([video([[167219, 1200147]]), audio([])])).toBe(false);
  });

  it("leaves a multi-entry video edit alone", () => {
    expect(shouldStripLeadIn([video([[-1, 1000], [167219, 1200147]]), audio([[134272, 960384]])])).toBe(false);
  });

  it("leaves a multi-entry audio edit alone", () => {
    expect(shouldStripLeadIn([video([[167219, 1200147]]), audio([[0, 1000], [134272, 960384]])])).toBe(false);
  });

  it("leaves media_time 0 alone", () => {
    expect(shouldStripLeadIn([video([[0, 1200147]]), audio([[0, 960384]])])).toBe(false);
  });

  it("leaves a B-frame delay edit alone (what plain ffmpeg writes for x264 + aac)", () => {
    // 1024/15360 = 67ms of composition delay, 1024/48000 = 21ms of AAC
    // priming. They agree within 50ms, but it's not a lead-in — nothing is
    // hidden that costs a player real decode time.
    expect(shouldStripLeadIn([video([[1024, 30720]], 15360), audio([[1024, 96000]])])).toBe(false);
  });

  it("strips a trimmed video with no audio track — there is no sync to lose", () => {
    expect(shouldStripLeadIn([video([[167219, 1200147]])])).toBe(true);
  });

  it("leaves a file with more than one video track alone", () => {
    expect(shouldStripLeadIn([video([[167219, 1200147]]), video([[167219, 1200147]])])).toBe(false);
  });

  it("ignores non-audio/video tracks such as timecode", () => {
    const tmcd: TrackEditList = { kind: "other", timescale: 60000, entries: [] };
    expect(shouldStripLeadIn([video([[167219, 1200147]]), audio([[134272, 960384]]), tmcd])).toBe(true);
  });
});

let dir: string;

async function ffmpeg(args: string[]) {
  const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", ...args], { stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${stderr}`);
}

/** Index of a top-level box type in the file, or -1. Fine for tiny fixtures. */
async function boxIndex(path: string, type: string): Promise<number> {
  const buf = Buffer.from(await Bun.file(path).arrayBuffer());
  return buf.indexOf(Buffer.from(type));
}

let full: string;
let cut: string;
let cutFast: string;
let noEdits: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clips-editlist-"));
  full = join(dir, "full.mp4");
  cut = join(dir, "cut.mp4");
  cutFast = join(dir, "cut-fast.mp4");
  noEdits = join(dir, "no-edits.mp4");

  // A 2s GOP and no B-frames, so the only thing the edit list encodes is the
  // lead-in back to the keyframe — the shape OBS writes.
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=30",
    "-f", "lavfi", "-i", "sine=duration=4:sample_rate=48000",
    "-c:v", "libx264", "-g", "60", "-bf", "0", "-pix_fmt", "yuv420p",
    "-c:a", "aac", full,
  ]);
  // Stream-copy seeking to a non-keyframe keeps the frames back to the
  // previous keyframe and hides them behind an edit list, like OBS does.
  // No faststart, so moov is at the end.
  await ffmpeg(["-ss", "1.2", "-i", full, "-c", "copy", cut]);
  await ffmpeg(["-ss", "1.2", "-i", full, "-c", "copy", "-movflags", "+faststart", cutFast]);
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10",
    "-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-use_editlist", "0", noEdits,
  ]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readEditLists", () => {
  it("finds the lead-in trims when moov is at the end of the file", async () => {
    expect(await boxIndex(cut, "moov")).toBeGreaterThan(await boxIndex(cut, "mdat"));

    const tracks = await readEditLists(cut);
    const v = tracks.find((t) => t.kind === "video");
    const a = tracks.find((t) => t.kind === "audio");

    expect(v?.entries).toHaveLength(1);
    expect(a?.entries).toHaveLength(1);
    // Cut at 1.2s, keyframes every 2s → 1.2s of hidden lead-in.
    expect(v!.entries[0].mediaTime / v!.timescale).toBeCloseTo(1.2, 1);
    expect(a!.entries[0].mediaTime / a!.timescale).toBeCloseTo(1.2, 1);
    expect(shouldStripLeadIn(tracks)).toBe(true);
  });

  it("reads the same trims from a faststart file", async () => {
    expect(await boxIndex(cutFast, "moov")).toBeLessThan(await boxIndex(cutFast, "mdat"));
    expect(await readEditLists(cutFast)).toEqual(await readEditLists(cut));
  });

  it("reports tracks with no edit list as having no entries", async () => {
    const tracks = await readEditLists(noEdits);
    expect(tracks).toEqual([{ kind: "video", timescale: expect.any(Number), entries: [] }]);
  });

  it("returns no tracks for a file that is not MP4", async () => {
    const junk = join(dir, "junk.mp4");
    await Bun.write(junk, "not a video at all, just some bytes");
    expect(await readEditLists(junk)).toEqual([]);
  });

  it("returns no tracks for a Matroska file", async () => {
    const mkv = join(dir, "clip.mkv");
    await ffmpeg(["-i", cut, "-c", "copy", mkv]);
    expect(await readEditLists(mkv)).toEqual([]);
  });
});

describe("hasObsLeadIn", () => {
  it("is true for the lead-in fixture and false for a file with no edit list", async () => {
    expect(await hasObsLeadIn(cut)).toBe(true);
    expect(await hasObsLeadIn(noEdits)).toBe(false);
  });
});
