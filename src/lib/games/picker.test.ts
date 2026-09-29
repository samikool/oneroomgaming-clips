import { describe, expect, it } from "bun:test";
import { gameCover, pickerNotice } from "./picker";

describe("gameCover", () => {
  it("serves your game's saved cover", () => {
    expect(gameCover({ id: "g", name: "Tarkov", slug: "tarkov", coverPath: "g-co1.jpg" })).toBe("/media/covers/g-co1.jpg");
  });
  it("uses IGDB's thumbnail for an IGDB result", () => {
    expect(gameCover({ igdbId: 1, name: "Valorant", year: 2020, coverImageId: "co2mvt" }))
      .toBe("https://images.igdb.com/igdb/image/upload/t_thumb/co2mvt.jpg");
  });
  it("is null when there is no cover", () => {
    expect(gameCover({ id: "g", name: "x", slug: "x", coverPath: null })).toBeNull();
    expect(gameCover({ igdbId: 1, name: "x", year: null, coverImageId: null })).toBeNull();
  });
});

describe("pickerNotice", () => {
  it("says it is searching while a request is out", () => {
    expect(pickerNotice({ search: "searching", query: "valo", count: 0, igdbOnly: false })).toBe("Searching…");
  });
  it("offers the typed text as a new game when nothing matched", () => {
    expect(pickerNotice({ search: "done", query: "my game", count: 0, igdbOnly: false }))
      .toBe("No match. Enter keeps “my game” as a new game.");
  });
  it("only says there was no match when linking in admin", () => {
    expect(pickerNotice({ search: "done", query: "my game", count: 0, igdbOnly: true })).toBe("Nothing on IGDB for “my game”.");
  });
  it("says a failed search failed", () => {
    expect(pickerNotice({ search: "failed", query: "valo", count: 3, igdbOnly: false }))
      .toBe("Search failed. Keep typing to try again.");
  });
  it("is quiet when there are results or nothing has been asked", () => {
    expect(pickerNotice({ search: "done", query: "valo", count: 2, igdbOnly: false })).toBeNull();
    expect(pickerNotice({ search: "idle", query: "", count: 0, igdbOnly: false })).toBeNull();
  });
});
