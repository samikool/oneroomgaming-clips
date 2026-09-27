import { describe, expect, it } from "bun:test";
import { gapInGrid } from "./grid";

// Two rows of three 100×60 tiles with 10px gutters.
const tiles = [0, 1, 2, 3, 4, 5].map((i) => ({
  left: (i % 3) * 110,
  top: Math.floor(i / 3) * 70,
  width: 100,
  height: 60,
}));

describe("gapInGrid", () => {
  it("is the gap before the tile whose left half the pointer is over", () => {
    expect(gapInGrid(10, 30, tiles)).toBe(0);
    expect(gapInGrid(120, 30, tiles)).toBe(1);
    expect(gapInGrid(230, 100, tiles)).toBe(5);
  });

  it("is the gap after a tile past its middle", () => {
    expect(gapInGrid(80, 30, tiles)).toBe(1);
    expect(gapInGrid(300, 30, tiles)).toBe(3);
  });

  it("counts a pointer above the grid as the start and below it as the end", () => {
    expect(gapInGrid(200, -20, tiles)).toBe(0);
    expect(gapInGrid(0, 500, tiles)).toBe(6);
  });

  it("puts a pointer in the gutter between rows before the next row", () => {
    expect(gapInGrid(10, 65, tiles)).toBe(3);
  });

  it("is 0 for an empty grid", () => {
    expect(gapInGrid(0, 0, [])).toBe(0);
  });
});
