import { describe, expect, it } from "bun:test";
import { decayedWeight, HALF_LIFE_MS, WINDOW_MS } from "./scoring";

describe("decayedWeight", () => {
  it("is the full weight now, half after one half-life, a quarter after two", () => {
    expect(decayedWeight(4, 0)).toBeCloseTo(4);
    expect(decayedWeight(4, HALF_LIFE_MS)).toBeCloseTo(2);
    expect(decayedWeight(4, 2 * HALF_LIFE_MS)).toBeCloseTo(1);
  });

  it("is zero outside the window", () => {
    expect(decayedWeight(4, WINDOW_MS + 1)).toBe(0);
  });
});
