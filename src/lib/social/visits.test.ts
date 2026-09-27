import { describe, expect, it } from "bun:test";
import { rollVisit } from "./visits";

const H = 60 * 60 * 1000;

describe("rollVisit", () => {
  it("starts the very first visit", () => {
    expect(rollVisit({ lastSeenAt: 0, visitStartedAt: null }, 5 * H)).toEqual({ visitStartedAt: 5 * H, previousVisitAt: null });
  });

  it("does nothing inside the 2-hour gap", () => {
    expect(rollVisit({ lastSeenAt: 10 * H, visitStartedAt: 9 * H }, 11 * H)).toBeNull();
  });

  it("rolls the window after the gap", () => {
    expect(rollVisit({ lastSeenAt: 10 * H, visitStartedAt: 9 * H }, 13 * H)).toEqual({ visitStartedAt: 13 * H, previousVisitAt: 9 * H });
  });
});
