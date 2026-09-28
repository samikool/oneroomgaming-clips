import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { getClipMetadata, setClipGame } from "@/db/metadata";
import { games } from "@/db/schema";
import { searchClipIds } from "@/db/search";
import { gameCoverPath, linkGameRecord, resolveIgdbGame, setGameCover } from "./games";

let db: Db;
const clip = (title: string) => createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1 }).id;
const byName = (name: string) => db.select().from(games).where(eq(games.name, name)).get();
const lol = { igdbId: 115, name: "League of Legends" };

beforeEach(() => {
  db = createDb(":memory:");
});

describe("linkGameRecord", () => {
  it("links a free-text game and takes the official name and slug", () => {
    const a = clip("a");
    setClipGame(db, a, "League");
    const out = linkGameRecord(db, byName("League")!.id, lol);
    expect(db.select().from(games).all()).toEqual([
      { id: out.gameId, name: "League of Legends", slug: "league-of-legends", igdbId: 115, coverPath: null },
    ]);
    expect(out.staleCovers).toEqual([]);
    expect([...(searchClipIds(db, "legends") ?? [])]).toEqual([a]);
  });

  it("merges into the game already linked to that entry", () => {
    const a = clip("a");
    const b = clip("b");
    setClipGame(db, a, "League of Legends");
    const kept = linkGameRecord(db, byName("League of Legends")!.id, lol).gameId;
    setGameCover(db, kept, "kept.jpg");
    setClipGame(db, b, "LoL");
    const lolId = byName("LoL")!.id;
    setGameCover(db, lolId, "lol.jpg");

    const out = linkGameRecord(db, lolId, lol);
    expect(out).toEqual({ gameId: kept, staleCovers: ["lol.jpg"] });
    expect(db.select().from(games).all()).toHaveLength(1);
    expect(getClipMetadata(db, b).game?.id).toBe(kept);
  });

  it("merges a free-text game whose slug the official name takes", () => {
    const a = clip("a");
    const b = clip("b");
    setClipGame(db, a, "League");
    setClipGame(db, b, "league of legends");
    const out = linkGameRecord(db, byName("League")!.id, lol);
    expect(db.select().from(games).all()).toHaveLength(1);
    expect(getClipMetadata(db, b).game?.id).toBe(out.gameId);
  });

  it("is a no-op when relinking to the entry it already has", () => {
    setClipGame(db, clip("a"), "League of Legends");
    const id = byName("League of Legends")!.id;
    linkGameRecord(db, id, lol);
    expect(linkGameRecord(db, id, lol)).toEqual({ gameId: id, staleCovers: [] });
  });

  it("relinks to a different entry", () => {
    setClipGame(db, clip("a"), "Valorant");
    const id = byName("Valorant")!.id;
    linkGameRecord(db, id, { igdbId: 1, name: "Wrong Game" });
    linkGameRecord(db, id, { igdbId: 126459, name: "Valorant" });
    expect(db.select().from(games).get()).toMatchObject({ id, igdbId: 126459, name: "Valorant" });
  });
});

describe("same-named entries (remakes)", () => {
  const doom93 = { igdbId: 1, name: "Doom", year: 1993 };
  const doom16 = { igdbId: 2, name: "DOOM", year: 2016 };

  it("keeps a remake as its own game when the original is already linked", () => {
    const a = clip("a");
    const b = clip("b");
    const first = resolveIgdbGame(db, doom93).gameId;
    setClipGame(db, a, "Doom");
    const second = resolveIgdbGame(db, doom16).gameId;
    expect(second).not.toBe(first);
    expect(db.select().from(games).where(eq(games.id, first)).get()).toMatchObject({ igdbId: 1, slug: "doom" });
    expect(db.select().from(games).where(eq(games.id, second)).get()).toMatchObject({ igdbId: 2, slug: "doom-2016" });
    expect(getClipMetadata(db, a).game?.id).toBe(first);
    void b;
  });

  it("does not merge away a linked game whose slug the new name takes", () => {
    const original = resolveIgdbGame(db, doom93).gameId;
    setClipGame(db, clip("x"), "Doom Thing");
    const other = byName("Doom Thing")!.id;
    const out = linkGameRecord(db, other, doom16);
    expect(out.gameId).toBe(other);
    expect(db.select().from(games).where(eq(games.id, original)).get()?.igdbId).toBe(1);
    expect(db.select().from(games).where(eq(games.id, other)).get()).toMatchObject({ igdbId: 2, slug: "doom-2016" });
  });

  it("falls back to the IGDB id when the name has no usable slug", () => {
    const a = resolveIgdbGame(db, { igdbId: 7, name: "ゼルダ", year: null }).gameId;
    const b = resolveIgdbGame(db, { igdbId: 8, name: "マリオ", year: null }).gameId;
    expect(a).not.toBe(b);
    expect(db.select().from(games).where(eq(games.id, b)).get()?.slug).toBe("8");
  });
});

describe("resolveIgdbGame", () => {
  it("reuses the game already linked", () => {
    setClipGame(db, clip("a"), "League of Legends");
    const id = linkGameRecord(db, byName("League of Legends")!.id, lol).gameId;
    expect(resolveIgdbGame(db, lol).gameId).toBe(id);
  });

  it("links a free-text game with the same slug rather than adding a second", () => {
    setClipGame(db, clip("a"), "league of legends");
    const id = byName("league of legends")!.id;
    expect(resolveIgdbGame(db, lol).gameId).toBe(id);
    expect(db.select().from(games).all()).toHaveLength(1);
    expect(byName("League of Legends")?.igdbId).toBe(115);
  });

  it("creates a linked game when nothing matches", () => {
    const out = resolveIgdbGame(db, lol);
    expect(db.select().from(games).get()).toMatchObject({ id: out.gameId, igdbId: 115, slug: "league-of-legends" });
  });
});

describe("covers", () => {
  it("sets a cover and returns the previous one", () => {
    const id = resolveIgdbGame(db, lol).gameId;
    expect(setGameCover(db, id, "a.jpg")).toBeNull();
    expect(setGameCover(db, id, "b.jpg")).toBe("a.jpg");
    expect(gameCoverPath(db, id)).toBe("b.jpg");
  });

  it("carries the cover on clip metadata", () => {
    const a = clip("a");
    const id = resolveIgdbGame(db, lol).gameId;
    setGameCover(db, id, "c.jpg");
    setClipGame(db, a, "League of Legends");
    expect(getClipMetadata(db, a).game).toEqual({ id, name: "League of Legends", slug: "league-of-legends", coverPath: "c.jpg" });
  });
});
