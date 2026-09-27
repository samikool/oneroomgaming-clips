import { describe, expect, it } from "bun:test";
import { nextWatched } from "./watch-time";

describe("nextWatched", () => {
  it("accumulates normal playback", () => {
    let total = 0;
    let prev = 0;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      total = nextWatched(prev, t, total);
      prev = t;
    }
    expect(total).toBeCloseTo(1000);
  });

  it("adds nothing for a jump forward", () => {
    expect(nextWatched(1, 31, 500)).toBe(500);
  });

  it("adds nothing for a jump backward", () => {
    expect(nextWatched(10, 2, 500)).toBe(500);
  });
});
