import { describe, expect, it } from "bun:test";
import { formatBytes, formatDuration } from "@/lib/format";

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
