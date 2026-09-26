import { describe, expect, it } from "bun:test";
import { dropTarget } from "@/lib/theater/queue-drag";

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
