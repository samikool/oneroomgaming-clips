import { describe, expect, it } from "bun:test";
import { applyProfileUpdate, directoryFrom, standInProfile } from "./store";
import { defaultAccent } from "./palette";
import type { Profile } from "./types";

const sam: Profile = { username: "sam", userId: "U1", name: "Sam", accent: "cyan", bio: null, pictureVersion: null };

describe("profile directory", () => {
  it("indexes by username", () => {
    expect(directoryFrom([sam]).sam.name).toBe("Sam");
  });

  it("replaces an entry on update", () => {
    const next = applyProfileUpdate(directoryFrom([sam]), { ...sam, name: "Samwise" });
    expect(next.sam.name).toBe("Samwise");
  });

  it("adds someone new", () => {
    const kobe = { ...sam, username: "kobe", userId: "U2", name: "Kobe" };
    expect(Object.keys(applyProfileUpdate(directoryFrom([sam]), kobe)).sort()).toEqual(["kobe", "sam"]);
  });

  it("does not mutate the previous directory", () => {
    const before = directoryFrom([sam]);
    applyProfileUpdate(before, { ...sam, name: "Samwise" });
    expect(before.sam.name).toBe("Sam");
  });

  it("ignores an update that changes nothing, so nothing re-renders", () => {
    const before = directoryFrom([sam]);
    expect(applyProfileUpdate(before, { ...sam })).toBe(before);
  });

  it("stands in for someone it has not heard of", () => {
    expect(standInProfile("ghost")).toEqual({
      username: "ghost",
      userId: "",
      name: "ghost",
      accent: defaultAccent("ghost"),
      bio: null,
      pictureVersion: null,
    });
  });
});
