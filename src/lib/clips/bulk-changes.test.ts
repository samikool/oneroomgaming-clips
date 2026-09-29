import { describe, expect, it } from "bun:test";
import { MAX_IDS, parseBulkChanges, parseIds } from "./bulk-changes";

describe("parseIds", () => {
  it("dedupes and caps", () => {
    expect(parseIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(parseIds(Array.from({ length: MAX_IDS + 1 }, (_, i) => `c${i}`))).toBeNull();
    expect(parseIds("a")).toBeNull();
    expect(parseIds([1, "a"])).toEqual(["a"]);
  });
});

describe("parseBulkChanges", () => {
  it("defaults to changing nothing", () => {
    expect(parseBulkChanges(undefined)).toEqual({ game: { op: "leave" }, addTags: [], removeTags: [], addPeople: [], removePeople: [] });
  });

  it("normalizes tags and people", () => {
    const out = parseBulkChanges({ addTags: [" Ace ", "ace", "", "x".repeat(65)], addPeople: ["Ben", "ben"], removePeople: ["SAM"] });
    expect(out.addTags).toEqual(["ace"]);
    expect(out.addPeople).toEqual(["ben"]);
    expect(out.removePeople).toEqual(["sam"]);
  });

  it("lets a removal win over the same add", () => {
    const out = parseBulkChanges({ addTags: ["ace", "clutch"], removeTags: ["ACE"] });
    expect(out.addTags).toEqual(["clutch"]);
    expect(out.removeTags).toEqual(["ace"]);
  });

  it("caps each list at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(parseBulkChanges({ addTags: many }).addTags).toHaveLength(20);
  });

  it("reads each game op and falls back to leave", () => {
    expect(parseBulkChanges({ game: { op: "clear" } }).game).toEqual({ op: "clear" });
    expect(parseBulkChanges({ game: { op: "local", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" } }).game).toEqual({ op: "local", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(parseBulkChanges({ game: { op: "igdb", igdbId: 126459 } }).game).toEqual({ op: "igdb", igdbId: 126459 });
    expect(parseBulkChanges({ game: { op: "text", name: " Custom " } }).game).toEqual({ op: "text", name: "Custom" });
    expect(parseBulkChanges({ game: { op: "igdb", igdbId: "x" } }).game).toEqual({ op: "leave" });
    expect(parseBulkChanges({ game: { op: "local", id: "../x" } }).game).toEqual({ op: "leave" });
    expect(parseBulkChanges({ game: { op: "text", name: "" } }).game).toEqual({ op: "leave" });
  });
});
