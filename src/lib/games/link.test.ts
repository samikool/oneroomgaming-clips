import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { getClipMetadata, setClipGame } from "@/db/metadata";
import { games } from "@/db/schema";
import type { Igdb, IgdbGame } from "@/lib/igdb";
import { coversDir } from "@/lib/media/paths";
import { deleteGameWithCover, linkGameToIgdb, mergeGamesWithCovers, pickIgdbGameForClip } from "./link";

let db: Db;
let env: { MEDIA_ROOT: string };
const catalogue: Record<number, IgdbGame> = {
  115: { igdbId: 115, name: "League of Legends", year: 2009, coverImageId: "co49wj" },
  116: { igdbId: 116, name: "Coverless", year: null, coverImageId: null },
  117: { igdbId: 117, name: "Wild Rift", year: 2020, coverImageId: "conew" },
};
let failDownload = false;

const igdb: Igdb = {
  search: async () => [],
  getGame: async (id) => catalogue[id] ?? null,
  downloadCover: async (_imageId, dest) => {
    if (failDownload) throw new Error("timeout");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "img");
  },
};

const gameRow = (id: string) => db.select().from(games).where(eq(games.id, id)).get()!;
const covers = () => (existsSync(coversDir(env)) ? readdirSync(coversDir(env)).sort() : []);

beforeEach(() => {
  db = createDb(":memory:");
  env = { MEDIA_ROOT: mkdtempSync(join(tmpdir(), "link-")) };
  failDownload = false;
});

function freeText(name: string): string {
  const id = createClip(db, { title: name, originalFilename: "x.mp4", sizeBytes: 1 }).id;
  setClipGame(db, id, name);
  return db.select().from(games).where(eq(games.name, name)).get()!.id;
}

describe("linkGameToIgdb", () => {
  it("links, downloads the cover and records its filename", async () => {
    const id = freeText("League");
    expect(await linkGameToIgdb(db, env, igdb, id, 115)).toEqual({ ok: true, gameId: id });
    expect(gameRow(id)).toMatchObject({ name: "League of Legends", coverPath: `${id}-co49wj.jpg` });
    expect(covers()).toEqual([`${id}-co49wj.jpg`]);
  });

  it("stays linked without a cover when the download fails", async () => {
    failDownload = true;
    const id = freeText("League");
    expect((await linkGameToIgdb(db, env, igdb, id, 115)).ok).toBe(true);
    expect(gameRow(id)).toMatchObject({ igdbId: 115, coverPath: null });
  });

  it("links a game IGDB has no cover for, without downloading", async () => {
    const id = freeText("Coverless");
    await linkGameToIgdb(db, env, igdb, id, 116);
    expect(gameRow(id).coverPath).toBeNull();
    expect(covers()).toEqual([]);
  });

  it("drops the old cover when relinking to an entry with none", async () => {
    const id = freeText("League");
    await linkGameToIgdb(db, env, igdb, id, 115);
    await linkGameToIgdb(db, env, igdb, id, 116);
    expect(gameRow(id)).toMatchObject({ igdbId: 116, coverPath: null });
    expect(covers()).toEqual([]);
  });

  it("replaces the old cover file on relink", async () => {
    const id = freeText("League");
    await linkGameToIgdb(db, env, igdb, id, 115);
    await linkGameToIgdb(db, env, igdb, id, 117);
    expect(covers()).toEqual([`${id}-conew.jpg`]);
  });

  it("removes the cover of a game merged away", async () => {
    const kept = freeText("League of Legends");
    await linkGameToIgdb(db, env, igdb, kept, 115);
    const other = freeText("LoL");
    await linkGameToIgdb(db, env, igdb, other, 117); // gives LoL its own cover first
    await linkGameToIgdb(db, env, igdb, other, 115); // now it merges into `kept`
    expect(db.select().from(games).all().map((g) => g.id)).toEqual([kept]);
    expect(covers()).toEqual([`${kept}-co49wj.jpg`]);
  });

  it("reports an IGDB id that does not exist", async () => {
    expect(await linkGameToIgdb(db, env, igdb, freeText("x"), 999)).toEqual({ ok: false, error: "IGDB has no such game." });
  });
});

describe("pickIgdbGameForClip", () => {
  it("sets the clip's game to the linked one, creating it if needed", async () => {
    const clip = createClip(db, { title: "c", originalFilename: "c.mp4", sizeBytes: 1 }).id;
    expect(await pickIgdbGameForClip(db, env, igdb, clip, 115)).toEqual({ ok: true, name: "League of Legends" });
    expect(getClipMetadata(db, clip).game).toMatchObject({ name: "League of Legends", coverPath: expect.stringContaining("co49wj") });
  });

  it("does not re-download a cover the linked game already has", async () => {
    const a = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 }).id;
    const b = createClip(db, { title: "b", originalFilename: "b.mp4", sizeBytes: 1 }).id;
    await pickIgdbGameForClip(db, env, igdb, a, 115);
    failDownload = true;
    await pickIgdbGameForClip(db, env, igdb, b, 115);
    expect(getClipMetadata(db, b).game?.coverPath).toContain("co49wj");
  });
});

describe("admin merge and delete", () => {
  it("merge removes the loser's cover", async () => {
    const a = freeText("League");
    await linkGameToIgdb(db, env, igdb, a, 115);
    const b = freeText("Other");
    mergeGamesWithCovers(db, env, a, b);
    expect(covers()).toEqual([]);
  });

  it("delete removes the cover, and leaves it when refused", async () => {
    const a = freeText("League");
    await linkGameToIgdb(db, env, igdb, a, 115);
    expect(deleteGameWithCover(db, env, a, { force: false }).ok).toBe(false);
    expect(covers()).toHaveLength(1);
    expect(deleteGameWithCover(db, env, a, { force: true }).ok).toBe(true);
    expect(covers()).toEqual([]);
  });
});
