import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { resolveIgdbGame } from "@/db/games";
import { setClipGame } from "@/db/metadata";
import type { Igdb, IgdbGame } from "@/lib/igdb";
import { searchGamesForPicker } from "./search";

let db: Db;
const lol: IgdbGame = { igdbId: 115, name: "League of Legends", year: 2009, coverImageId: "co49wj" };
const lor: IgdbGame = { igdbId: 999, name: "Legends of Runeterra", year: 2020, coverImageId: null };
const igdbReturning = (results: IgdbGame[] | Error): Igdb => ({
  search: async () => {
    if (results instanceof Error) throw results;
    return results;
  },
  getGame: async () => null,
  downloadCover: async () => {},
});

beforeEach(() => {
  db = createDb(":memory:");
  setClipGame(db, createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 }).id, "Legendary Custom");
});

describe("searchGamesForPicker", () => {
  it("returns local matches first, then IGDB", async () => {
    const out = await searchGamesForPicker(db, igdbReturning([lol, lor]), "leg");
    expect(out.local.map((g) => g.name)).toEqual(["Legendary Custom"]);
    expect(out.igdb.map((g) => g.igdbId)).toEqual([115, 999]);
  });

  it("drops IGDB results already linked locally", async () => {
    resolveIgdbGame(db, { igdbId: 115, name: "League of Legends" });
    const out = await searchGamesForPicker(db, igdbReturning([lol, lor]), "leg");
    expect(out.local.map((g) => g.name)).toEqual(["League of Legends", "Legendary Custom"]);
    expect(out.igdb.map((g) => g.igdbId)).toEqual([999]);
  });

  it("returns only local games when IGDB fails", async () => {
    const out = await searchGamesForPicker(db, igdbReturning(new Error("down")), "leg");
    expect(out).toMatchObject({ igdb: [] });
    expect(out.local).toHaveLength(1);
  });

  it("returns only local games when IGDB is disabled", async () => {
    expect((await searchGamesForPicker(db, null, "leg")).igdb).toEqual([]);
  });

  it("returns nothing under two characters", async () => {
    expect(await searchGamesForPicker(db, igdbReturning([lol]), " l ")).toEqual({ local: [], igdb: [] });
  });

  it("treats LIKE wildcards in the query literally", async () => {
    expect((await searchGamesForPicker(db, null, "%%")).local).toEqual([]);
  });
});
