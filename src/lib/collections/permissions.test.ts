import { describe, expect, it } from "bun:test";
import { canCollection } from "./permissions";

const owner = { isOwner: true, open: false };
const otherClosed = { isOwner: false, open: false };
const otherOpen = { isOwner: false, open: true };

describe("canCollection", () => {
  it("everyone can view", () => {
    for (const ctx of [owner, otherClosed, otherOpen]) expect(canCollection("view", ctx)).toBe(true);
  });

  it("adding: owner always, others only when open", () => {
    expect(canCollection("add", owner)).toBe(true);
    expect(canCollection("add", otherOpen)).toBe(true);
    expect(canCollection("add", otherClosed)).toBe(false);
  });

  it("removing: owner anything; others only their own adds in an open collection", () => {
    expect(canCollection("remove", { ...owner, addedByMe: false })).toBe(true);
    expect(canCollection("remove", { ...otherOpen, addedByMe: true })).toBe(true);
    expect(canCollection("remove", { ...otherOpen, addedByMe: false })).toBe(false);
    expect(canCollection("remove", { ...otherClosed, addedByMe: true })).toBe(false);
    expect(canCollection("remove", otherOpen)).toBe(false);
  });

  it("reorder, edit and delete are the owner's", () => {
    for (const action of ["reorder", "edit", "delete"] as const) {
      expect(canCollection(action, owner)).toBe(true);
      expect(canCollection(action, { ...owner, open: true })).toBe(true);
      expect(canCollection(action, otherOpen)).toBe(false);
      expect(canCollection(action, otherClosed)).toBe(false);
    }
  });
});
