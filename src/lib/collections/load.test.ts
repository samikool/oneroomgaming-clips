import { describe, expect, it } from "bun:test";
import { buildLoadList, loadSummary } from "./load";

const clip = (id: string, status = "ready") => ({ id, title: `t-${id}`, status, durationMs: 1_000 });

describe("buildLoadList", () => {
  it("keeps ready clips in collection order", () => {
    expect(buildLoadList({ clips: [clip("b"), clip("a"), clip("c")] })).toEqual({
      clips: [
        { clipId: "b", title: "t-b", durationMs: 1_000 },
        { clipId: "a", title: "t-a", durationMs: 1_000 },
        { clipId: "c", title: "t-c", durationMs: 1_000 },
      ],
      skipped: 0,
    });
  });

  it("skips and counts clips that aren't ready", () => {
    const list = buildLoadList({
      clips: [clip("a"), clip("b", "processing"), clip("c", "failed"), clip("d"), clip("e", "pending")],
    });
    expect(list.clips.map((c) => c.clipId)).toEqual(["a", "d"]);
    expect(list.skipped).toBe(3);
  });

  it("is empty for an empty collection", () => {
    expect(buildLoadList({ clips: [] })).toEqual({ clips: [], skipped: 0 });
  });
});

describe("loadSummary", () => {
  it("says how many were skipped, or nothing", () => {
    expect(loadSummary(0)).toBeNull();
    expect(loadSummary(1)).toBe("Skipped 1 clip still processing");
    expect(loadSummary(2)).toBe("Skipped 2 clips still processing");
  });
});
