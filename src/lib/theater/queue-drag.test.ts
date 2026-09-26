import { describe, expect, it } from "bun:test";
import { dropTarget, gapAtPointer } from "@/lib/theater/queue-drag";

// Queue [A, B, C, D]; `before` is the gap the entry was dropped into, where 0
// is above A and 4 is below D.
describe("dropTarget", () => {
  it("moves up into an earlier gap unchanged", () => {
    expect(dropTarget(3, 1)).toBe(1);
  });

  it("moves down, accounting for the entry leaving its old place", () => {
    expect(dropTarget(0, 3)).toBe(2);
    expect(dropTarget(0, 4)).toBe(3);
  });

  it("is a no-op when dropped into either gap beside itself", () => {
    expect(dropTarget(1, 1)).toBeNull();
    expect(dropTarget(1, 2)).toBeNull();
  });
});

// Three 40px rows with 8px between them, starting at y=100: midpoints at
// 120, 168 and 216.
describe("gapAtPointer", () => {
  const rows = [
    { top: 100, height: 40 },
    { top: 148, height: 40 },
    { top: 196, height: 40 },
  ];

  it("picks the gap above the first row whose midpoint is below the pointer", () => {
    expect(gapAtPointer(110, rows)).toBe(0);
    expect(gapAtPointer(130, rows)).toBe(1);
    expect(gapAtPointer(200, rows)).toBe(2);
  });

  it("treats the space between rows as the gap they share", () => {
    expect(gapAtPointer(144, rows)).toBe(1);
  });

  it("clamps above the list to the first gap and below it to the last", () => {
    expect(gapAtPointer(0, rows)).toBe(0);
    expect(gapAtPointer(220, rows)).toBe(3);
    expect(gapAtPointer(900, rows)).toBe(3);
  });

  it("is the only gap for an empty list", () => {
    expect(gapAtPointer(50, [])).toBe(0);
  });
});
