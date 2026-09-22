import { describe, expect, it } from "bun:test";
import { formatDuration } from "@/lib/format";

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(42_000)).toBe("0:42");
  });

  it("pads seconds", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("formats durations over an hour", () => {
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });

  it("renders a dash when the duration is unknown", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("renders zero as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});
