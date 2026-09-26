import { describe, expect, it } from "bun:test";
import { initialOf, profileHref, usernameFromParam } from "./href";

describe("profileHref", () => {
  it("encodes usernames safely", () => {
    expect(profileHref("sam")).toBe("/u/sam");
    expect(profileHref("a b+c/d")).toBe("/u/a%20b%2Bc%2Fd");
    expect(profileHref("a.b")).toBe("/u/a.b");
  });
});

describe("usernameFromParam", () => {
  it("round-trips what profileHref encodes", () => {
    for (const name of ["sam", "a.b", "a+b", "a b+c/d", "50%off"]) {
      const param = profileHref(name).slice("/u/".length);
      expect(usernameFromParam(param)).toBe(name);
    }
  });

  it("leaves a malformed escape as it is rather than throwing", () => {
    expect(usernameFromParam("100%")).toBe("100%");
  });
});

describe("initialOf", () => {
  it("takes the first character, uppercased, emoji-safe", () => {
    expect(initialOf("sam")).toBe("S");
    expect(initialOf("🔥fire")).toBe("🔥");
    expect(initialOf("")).toBe("?");
  });
});
