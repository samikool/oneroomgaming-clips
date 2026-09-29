import { describe, expect, it } from "bun:test";
import type { PickerResults } from "@/lib/games/search";
import {
  cleanTitle, dateFromFilename, folderOf, fromLocalInput, peopleFromPath, pickGame, toLocalInput,
} from "./infer";

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

describe("folderOf", () => {
  it("is the immediate parent folder, or empty for a loose file", () => {
    expect(folderOf("Clips/War Thunder/FW190.mp4")).toBe("War Thunder");
    expect(folderOf("War Thunder/FW190.mp4")).toBe("War Thunder");
    expect(folderOf("FW190.mp4")).toBe("");
  });
});

describe("dateFromFilename", () => {
  it("reads ShadowPlay stamps", () => {
    expect(dateFromFilename("Valorant 2022.02.17 - 21.14.02.03.DVR.mp4")).toBe(local(2022, 2, 17, 21, 14, 2));
  });
  it("reads OBS stamps", () => {
    expect(dateFromFilename("2022-03-05 20-01-33.mp4")).toBe(local(2022, 3, 5, 20, 1, 33));
    expect(dateFromFilename("Replay 2025-03-01 21-14-02.mkv")).toBe(local(2025, 3, 1, 21, 14, 2));
  });
  it("reads compact stamps", () => {
    expect(dateFromFilename("VID_20230704_183012.mp4")).toBe(local(2023, 7, 4, 18, 30, 12));
  });
  it("reads a date with no time as midnight", () => {
    expect(dateFromFilename("Rocket League 2021-11-02.mp4")).toBe(local(2021, 11, 2));
  });
  it("gives nothing for a month and day without a year", () => {
    expect(dateFromFilename("NA1-4213 Draven 03-12.webm")).toBeNull();
  });
  it("gives nothing for a hand-named file or an impossible date", () => {
    expect(dateFromFilename("did_i_get_him.mp4")).toBeNull();
    expect(dateFromFilename("clip 2022-13-45.mp4")).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("turns underscores into spaces", () => {
    expect(cleanTitle("we_do_a_little_breaching_and_clearing.mp4", null)).toBe("we do a little breaching and clearing");
  });
  it("strips recorder stamps and counters", () => {
    expect(cleanTitle("Valorant 2022.02.17 - 21.14.02.03.DVR.mp4", null)).toBe("Valorant");
    expect(cleanTitle("Replay 2025-03-01 21-14-02.mkv", null)).toBe("Replay 2025-03-01 21-14-02");
    expect(cleanTitle("Helo (2).mp4", null)).toBe("Helo");
    expect(cleanTitle("Ben doubts my flank-1.mp4", null)).toBe("Ben doubts my flank");
  });
  it("falls back to the date when nothing is left", () => {
    const at = local(2022, 3, 5, 20, 1, 33);
    expect(cleanTitle("2022-03-05 20-01-33.mp4", at)).toBe(new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  });
  it("falls back to the stem when nothing is left and there is no date", () => {
    expect(cleanTitle("DVR.mp4", null)).toBe("DVR");
  });
});

describe("peopleFromPath", () => {
  const people = [
    { username: "sam", name: "Sam" },
    { username: "bdawg", name: "Brandon" },
    { username: "trey", name: "TFever" },
  ];
  it("matches usernames and display names as whole words, case-insensitively", () => {
    expect(peopleFromPath("Bdawg and the Bois/Treys Bad.mp4", people)).toEqual(["bdawg"]);
    expect(peopleFromPath("General/brandon vs TFever.mp4", people)).toEqual(["bdawg", "trey"]);
    expect(peopleFromPath("Sam_s Mechanics OP.mp4", people)).toEqual(["sam"]);
  });
  it("does not match inside a longer word", () => {
    expect(peopleFromPath("sammy ace.mp4", people)).toEqual([]);
  });
});

describe("pickGame", () => {
  const empty: PickerResults = { local: [], igdb: [] };
  const g = (name: string, coverPath: string | null = null) => ({ id: `id-${name}`, name, slug: name.toLowerCase(), coverPath });
  const i = (igdbId: number, name: string, coverImageId: string | null = null) => ({ igdbId, name, year: 2020, coverImageId });

  it("prefers an exact local match, ignoring case and punctuation", () => {
    expect(pickGame("war-thunder", { local: [g("War Thunder")], igdb: [i(1, "War Thunder")] }))
      .toEqual({ kind: "local", id: "id-War Thunder", name: "War Thunder", cover: null });
  });
  it("then a local game the folder name contains", () => {
    expect(pickGame("General League Clips", { local: [g("League of Legends"), g("League")], igdb: [] }))
      .toEqual({ kind: "local", id: "id-League", name: "League", cover: null });
  });
  it("then IGDB's top result", () => {
    expect(pickGame("Valorant", { local: [], igdb: [i(126459, "Valorant"), i(2, "x")] }))
      .toEqual({ kind: "igdb", igdbId: 126459, name: "Valorant", cover: null });
  });
  it("carries the cover, so a guess shows its art", () => {
    expect(pickGame("Tarkov", { local: [g("Tarkov", "t-co1.jpg")], igdb: [] }))
      .toMatchObject({ cover: "/media/covers/t-co1.jpg" });
    expect(pickGame("Valorant", { local: [], igdb: [i(1, "Valorant", "co2mvt")] }))
      .toMatchObject({ cover: "https://images.igdb.com/igdb/image/upload/t_thumb/co2mvt.jpg" });
  });
  it("gives nothing for a loose group or no results", () => {
    expect(pickGame("", { local: [g("x")], igdb: [] })).toBeNull();
    expect(pickGame("Stuff", empty)).toBeNull();
  });
});

describe("datetime-local round trip", () => {
  it("formats and parses local time, and treats empty as none", () => {
    const at = local(2022, 2, 17, 21, 14);
    expect(toLocalInput(at)).toBe("2022-02-17T21:14");
    expect(fromLocalInput("2022-02-17T21:14")).toBe(at);
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});
