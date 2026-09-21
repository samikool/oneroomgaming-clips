import { describe, expect, it } from "bun:test";
import { shouldShowChangelog } from "@/lib/changelog-visibility";

describe("shouldShowChangelog", () => {
  it("does not show on first visit (no stored value)", () => {
    expect(shouldShowChangelog({ latest: "0.1.0", lastSeen: null })).toBe(
      false,
    );
  });

  it("does not show when stored value equals latest", () => {
    expect(
      shouldShowChangelog({ latest: "0.1.0", lastSeen: "0.1.0" }),
    ).toBe(false);
  });

  it("shows when stored value differs from latest", () => {
    expect(
      shouldShowChangelog({ latest: "0.2.0", lastSeen: "0.1.0" }),
    ).toBe(true);
  });

  it("shows on a rollback where stored is newer than latest", () => {
    expect(
      shouldShowChangelog({ latest: "0.1.0", lastSeen: "0.2.0" }),
    ).toBe(true);
  });

  it("does not show and does not propagate when localStorage read throws", () => {
    const throwingRead = () => {
      throw new Error("localStorage disabled");
    };

    expect(() =>
      shouldShowChangelog({ latest: "0.1.0", readLastSeen: throwingRead }),
    ).not.toThrow();

    expect(
      shouldShowChangelog({ latest: "0.1.0", readLastSeen: throwingRead }),
    ).toBe(false);
  });
});
