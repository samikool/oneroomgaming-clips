import { describe, expect, it } from "bun:test";
import { clampOffset, coverCrop } from "./crop";

describe("coverCrop", () => {
  it("takes the centred largest square at zoom 1", () => {
    expect(coverCrop(400, 200, 1, 0, 0)).toEqual({ sx: 100, sy: 0, sSize: 200 });
  });

  it("zooming in takes a smaller square around the same centre", () => {
    expect(coverCrop(400, 200, 2, 0, 0)).toEqual({ sx: 150, sy: 50, sSize: 100 });
  });

  it("offsets pan the square but never past the image edge", () => {
    expect(coverCrop(400, 200, 1, 1000, 0).sx).toBe(200);
    expect(coverCrop(400, 200, 1, -1000, 0).sx).toBe(0);
    expect(coverCrop(400, 200, 2, 0, -1000).sy).toBe(0);
  });

  it("treats a zoom below 1 as 1", () => {
    expect(coverCrop(400, 200, 0.5, 0, 0)).toEqual({ sx: 100, sy: 0, sSize: 200 });
  });
});

describe("clampOffset", () => {
  it("keeps a pan within the room the zoom leaves", () => {
    // 400x200 at zoom 1: a 200 square, 100 spare on each side horizontally, none vertically.
    expect(clampOffset(400, 200, 1, 1000, 50)).toEqual({ x: 100, y: 0 });
    expect(clampOffset(400, 200, 1, -1000, -50)).toEqual({ x: -100, y: 0 });
    // Zoom 2: a 100 square, 150 spare each side horizontally, 50 vertically.
    expect(clampOffset(400, 200, 2, 20, -70)).toEqual({ x: 20, y: -50 });
  });
});
