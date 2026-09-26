import { describe, expect, it } from "bun:test";
import { formatAgo, formatBytes, formatDuration } from "@/lib/format";

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

describe("formatBytes", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("steps up through the units", () => {
    expect(formatBytes(1_024)).toBe("1.0 KB");
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });

  it("keeps one decimal place where it is informative", () => {
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("handles zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("formatAgo", () => {
  const now = 1_000_000_000_000;

  it("says just now under a minute, and for clocks slightly ahead", () => {
    expect(formatAgo(now - 30_000, now)).toBe("just now");
    expect(formatAgo(now + 5_000, now)).toBe("just now");
  });

  it("uses the largest whole unit", () => {
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatAgo(now - 400 * 86_400_000, now)).toBe("1y ago");
  });
});
