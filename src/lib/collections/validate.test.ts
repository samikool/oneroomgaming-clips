import { describe, expect, it } from "bun:test";
import { CollectionValidationError, validateCollection } from "./validate";

describe("validateCollection", () => {
  it("trims and accepts a name, nulls an empty description", () => {
    expect(validateCollection({ name: "  Kobe fails ", description: "  " })).toEqual({ name: "Kobe fails", description: null });
  });

  it("rejects an empty or 61-character name and a 281-character description", () => {
    expect(() => validateCollection({ name: " " })).toThrow(CollectionValidationError);
    expect(() => validateCollection({ name: "x".repeat(61) })).toThrow(CollectionValidationError);
    expect(() => validateCollection({ description: "x".repeat(281) })).toThrow(CollectionValidationError);
  });

  it("counts emoji as one character", () => {
    expect(validateCollection({ name: "🔥".repeat(60) }).name).toBe("🔥".repeat(60));
  });

  it("rejects control characters in a name but keeps line breaks in a description", () => {
    expect(() => validateCollection({ name: "a\u0007b" })).toThrow(CollectionValidationError);
    expect(validateCollection({ description: "one\ntwo" }).description).toBe("one\ntwo");
  });
});
