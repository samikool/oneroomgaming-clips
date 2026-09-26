import { describe, expect, it } from "bun:test";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor", () => {
  it("round-trips an offset for its sort", () => {
    expect(decodeCursor(encodeCursor("top", 48), "top")).toBe(48);
  });

  it("is the first page for another sort's cursor, junk, or nothing", () => {
    expect(decodeCursor(encodeCursor("top", 48), "new")).toBe(0);
    expect(decodeCursor("%%%not-a-cursor", "new")).toBe(0);
    expect(decodeCursor(undefined, "new")).toBe(0);
    expect(decodeCursor(encodeCursor("new", -5), "new")).toBe(0);
  });
});
