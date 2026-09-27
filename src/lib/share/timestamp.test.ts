import { describe, expect, it } from "bun:test";
import { clampStart, formatClock, parsePositionMs, parseStartSeconds, shareUrl } from "./timestamp";

describe("parseStartSeconds", () => {
  it("accepts whole non-negative seconds", () => {
    expect(parseStartSeconds("42")).toBe(42);
    expect(parseStartSeconds("0")).toBe(0);
  });

  it("ignores junk", () => {
    for (const raw of ["-5", "abc", "1.5", "1e9", "", null, undefined, " 4", "99999999999"]) {
      expect(parseStartSeconds(raw)).toBeNull();
    }
  });
});

describe("clampStart", () => {
  it("keeps a start inside the clip", () => {
    expect(clampStart(500, 60)).toBe(59);
    expect(clampStart(10, 60)).toBe(10);
    expect(clampStart(10, 0.5)).toBe(0);
  });

  it("leaves the start alone when the duration isn't known", () => {
    expect(clampStart(10, Number.NaN)).toBe(10);
    expect(clampStart(10, Number.POSITIVE_INFINITY)).toBe(10);
  });
});

describe("shareUrl", () => {
  it("builds links with and without a start", () => {
    expect(shareUrl("https://clips.oneroomgaming.com", "C1", 42)).toBe("https://clips.oneroomgaming.com/clips/C1?t=42");
    expect(shareUrl("https://dev.clips.oneroomgaming.com", "C1", null)).toBe("https://dev.clips.oneroomgaming.com/clips/C1");
    expect(shareUrl("https://x", "C1", 0)).toBe("https://x/clips/C1");
  });
});

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(42_000)).toBe("0:42");
    expect(formatClock(62_000)).toBe("1:02");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(42_999)).toBe("0:42");
  });
});

describe("comment timestamp links", () => {
  it("are same-origin paths with the second the comment was written at", () => {
    expect(shareUrl("", "C1", Math.floor(42_900 / 1000))).toBe("/clips/C1?t=42");
  });
});

describe("parsePositionMs", () => {
  it("takes a whole non-negative millisecond count from a form value", () => {
    expect(parsePositionMs("42000")).toBe(42_000);
    expect(parsePositionMs("0")).toBe(0);
  });

  it("is null for anything else, including a missing field", () => {
    for (const raw of [null, "", "-1", "1.5", "abc", "Infinity", " 5"]) {
      expect(parsePositionMs(raw)).toBeNull();
    }
  });
});
