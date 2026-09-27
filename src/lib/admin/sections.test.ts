import { describe, expect, it } from "bun:test";
import { parseSection } from "./sections";
import { assertAdmin, NotAuthorizedError } from "@/lib/auth";

describe("parseSection", () => {
  it("defaults to clips and accepts known sections", () => {
    expect(parseSection(undefined)).toBe("clips");
    expect(parseSection("jobs")).toBe("jobs");
    expect(parseSection("hax")).toBe("clips");
    expect(parseSection(["games", "users"])).toBe("games");
  });
});

describe("the admin gate every action uses", () => {
  it("refuses anyone not in CLIPS_ADMINS", () => {
    expect(() => assertAdmin({ username: "kobe", email: null, displayName: null }, { CLIPS_ADMINS: "sam" })).toThrow(NotAuthorizedError);
    expect(assertAdmin({ username: "sam", email: null, displayName: null }, { CLIPS_ADMINS: "sam" }).username).toBe("sam");
  });
});
