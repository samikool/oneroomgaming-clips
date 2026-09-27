import { describe, expect, it } from "bun:test";
import { swipeResult } from "./swipe";

describe("swipeResult", () => {
  it("moves one tab on a clear horizontal swipe", () => {
    expect(swipeResult(-80, 10, 1, 4)).toBe(2);
    expect(swipeResult(80, -5, 1, 4)).toBe(0);
  });

  it("ignores short or mostly-vertical movement", () => {
    expect(swipeResult(-50, 0, 1, 4)).toBe(1);
    expect(swipeResult(-70, 90, 1, 4)).toBe(1);
  });

  it("stops at the ends", () => {
    expect(swipeResult(80, 0, 0, 4)).toBe(0);
    expect(swipeResult(-80, 0, 3, 4)).toBe(3);
  });
});
