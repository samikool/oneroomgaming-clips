import { describe, expect, it } from "bun:test";
import { seededShuffle } from "./shuffle";

const items = Array.from({ length: 50 }, (_, i) => `c${i}`);

describe("seededShuffle", () => {
  it("is stable for a seed", () => {
    expect(seededShuffle(items, 7)).toEqual(seededShuffle(items, 7));
  });

  it("differs across seeds", () => {
    expect(seededShuffle(items, 7)).not.toEqual(seededShuffle(items, 8));
  });

  it("is a permutation and leaves the input alone", () => {
    const copy = [...items];
    expect([...seededShuffle(items, 3)].sort()).toEqual([...items].sort());
    expect(items).toEqual(copy);
  });
});
