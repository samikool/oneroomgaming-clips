import { describe, expect, it } from "bun:test";
import { ACCENT_KEYS, ACCENTS, SURFACE, contrastRatio, defaultAccent, isAccentKey } from "./palette";

describe("palette", () => {
  it("has about a dozen accents", () => {
    expect(ACCENT_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(ACCENT_KEYS.length).toBeLessThanOrEqual(14);
  });

  it("every accent is readable on the page background (WCAG AA 4.5:1)", () => {
    for (const key of ACCENT_KEYS) {
      expect(contrastRatio(ACCENTS[key], SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("computes known contrast ratios", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#000000")).toBeCloseTo(1, 5);
  });

  it("gives each username a stable default", () => {
    expect(defaultAccent("sam")).toBe(defaultAccent("sam"));
    expect(isAccentKey(defaultAccent("kobe"))).toBe(true);
  });

  it("spreads defaults across the palette", () => {
    const names = ["sam", "kobe", "puddy", "alex", "jordan", "casey", "riley", "morgan"];
    expect(new Set(names.map(defaultAccent)).size).toBeGreaterThanOrEqual(4);
  });

  it("rejects unknown keys", () => {
    expect(isAccentKey("cyan")).toBe(true);
    expect(isAccentKey("chartreuse-ish")).toBe(false);
    expect(isAccentKey(3)).toBe(false);
  });
});
