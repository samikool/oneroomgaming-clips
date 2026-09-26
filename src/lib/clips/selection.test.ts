import { describe, expect, it } from "bun:test";
import { isAllSelected, pruneSelection, selectAll, toggleSelection } from "@/lib/clips/selection";

describe("toggleSelection", () => {
  it("selects an unselected clip", () => {
    expect([...toggleSelection(new Set(), "a")]).toEqual(["a"]);
  });

  it("deselects a selected clip", () => {
    expect([...toggleSelection(new Set(["a"]), "a")]).toEqual([]);
  });

  it("leaves other selections alone", () => {
    expect([...toggleSelection(new Set(["a", "b"]), "b")].sort()).toEqual(["a"]);
  });

  it("does not mutate the set it was given", () => {
    const selected = new Set(["a"]);

    toggleSelection(selected, "b");

    expect([...selected]).toEqual(["a"]);
  });
});

describe("pruneSelection", () => {
  // The bug this exists to prevent: someone else deletes a clip you have
  // selected, the card vanishes, and the bar keeps claiming you have 2.
  it("drops selected ids that are no longer in the grid", () => {
    const pruned = pruneSelection(new Set(["a", "b"]), ["b", "c"]);

    expect([...pruned]).toEqual(["b"]);
  });

  it("returns the same set when every selection is still present", () => {
    const selected = new Set(["a", "b"]);

    expect(pruneSelection(selected, ["a", "b", "c"])).toBe(selected);
  });

  it("returns the same set when nothing is selected", () => {
    const selected: Set<string> = new Set();

    expect(pruneSelection(selected, ["a"])).toBe(selected);
  });

  it("empties the selection when the grid empties", () => {
    expect([...pruneSelection(new Set(["a"]), [])]).toEqual([]);
  });

  it("does not mutate the set it was given", () => {
    const selected = new Set(["a", "b"]);

    pruneSelection(selected, ["a"]);

    expect([...selected].sort()).toEqual(["a", "b"]);
  });
});

describe("selectAll", () => {
  it("selects every id in the grid", () => {
    expect([...selectAll(["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
  });

  it("selects nothing for an empty grid", () => {
    expect([...selectAll([])]).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const ids = ["a", "b"];

    selectAll(ids).delete("a");

    expect(ids).toEqual(["a", "b"]);
  });
});

describe("isAllSelected", () => {
  it("is true when every clip in the grid is selected", () => {
    expect(isAllSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
  });

  it("is false when any clip in the grid is unselected", () => {
    expect(isAllSelected(new Set(["a"]), ["a", "b"])).toBe(false);
  });

  // A stale id (pruned on the next render) must not make a partial selection
  // read as complete.
  it("ignores selected ids that are not in the grid", () => {
    expect(isAllSelected(new Set(["a", "gone"]), ["a", "b"])).toBe(false);
  });

  it("is false for an empty grid", () => {
    expect(isAllSelected(new Set(), [])).toBe(false);
  });
});
