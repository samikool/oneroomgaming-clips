import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { getClipMetadata, setClipGame, setClipTags } from "@/db/metadata";
import { searchClipIds } from "@/db/search";
import { clipTags, games, tags } from "@/db/schema";
import {
  deleteGame,
  deleteTag,
  listGamesWithCounts,
  listTagsWithCounts,
  mergeGames,
  mergeTags,
  renameGame,
  renameTag,
} from "./games-tags";

let db: Db;
let clipId: string;
const gameId = (name: string) => db.select().from(games).where(eq(games.name, name)).get()!.id;
const tagId = (name: string) => db.select().from(tags).where(eq(tags.name, name)).get()!.id;
const ids = (q: string) => [...(searchClipIds(db, q) ?? [])];

beforeEach(() => {
  db = createDb(":memory:");
  const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

describe("games", () => {
  it("renames, regenerating the slug and the search index", () => {
    setClipGame(db, clipId, "Apex");
    expect(renameGame(db, gameId("Apex"), "Apex Legends")).toEqual({ ok: true });
    expect(db.select().from(games).get()).toMatchObject({ name: "Apex Legends", slug: "apex-legends" });
    expect(ids("legends")).toEqual([clipId]);
  });

  it("refuses a name another game already has, with a message rather than a throw", () => {
    setClipGame(db, clipId, "Apex Legends");
    const other = createClip(db, { title: "y", originalFilename: "y.mp4", sizeBytes: 1 }).id;
    setClipGame(db, other, "Valorant");
    expect(renameGame(db, gameId("Valorant"), "apex legends")).toEqual({
      ok: false,
      error: "A game with that name already exists — merge instead.",
    });
    expect(renameGame(db, gameId("Valorant"), "  ")).toMatchObject({ ok: false });
    expect(getClipMetadata(db, other).game?.name).toBe("Valorant");
  });

  it("renaming to a new spelling of its own slug is allowed", () => {
    setClipGame(db, clipId, "valorant");
    expect(renameGame(db, gameId("valorant"), "Valorant")).toEqual({ ok: true });
    expect(getClipMetadata(db, clipId).game?.name).toBe("Valorant");
  });

  it("merges clips into the target, removes the source and reindexes", () => {
    setClipGame(db, clipId, "apex legendz");
    const other = createClip(db, { title: "y", originalFilename: "y.mp4", sizeBytes: 1 }).id;
    setClipGame(db, other, "Apex");
    expect(mergeGames(db, gameId("apex legendz"), gameId("Apex"))).toBe(1);
    expect(getClipMetadata(db, clipId).game?.name).toBe("Apex");
    expect(db.select().from(games).all()).toHaveLength(1);
    expect(ids("legendz")).toEqual([]);
    expect(ids("apex").sort()).toEqual([clipId, other].sort());
  });

  it("refuses to merge a game into itself", () => {
    setClipGame(db, clipId, "Apex");
    expect(() => mergeGames(db, gameId("Apex"), gameId("Apex"))).toThrow();
    expect(db.select().from(games).all()).toHaveLength(1);
  });

  it("deletes only when unused unless forced, then detaches and reindexes", () => {
    setClipGame(db, clipId, "Apex");
    expect(deleteGame(db, gameId("Apex"), { force: false })).toEqual({ ok: false, inUse: 1 });
    expect(deleteGame(db, gameId("Apex"), { force: true })).toEqual({ ok: true, detached: 1 });
    expect(getClipMetadata(db, clipId).game).toBeNull();
    expect(ids("apex")).toEqual([]);
  });

  it("deletes an unused game straight away", () => {
    setClipGame(db, clipId, "Apex");
    setClipGame(db, clipId, null);
    expect(deleteGame(db, gameId("Apex"), { force: false })).toEqual({ ok: true, detached: 0 });
    expect(db.select().from(games).all()).toHaveLength(0);
  });

  it("lists with clip counts", () => {
    setClipGame(db, clipId, "Apex");
    setClipGame(db, createClip(db, { title: "y", originalFilename: "y.mp4", sizeBytes: 1 }).id, "Apex");
    setClipGame(db, createClip(db, { title: "z", originalFilename: "z.mp4", sizeBytes: 1 }).id, "Valorant");
    const w = createClip(db, { title: "w", originalFilename: "w.mp4", sizeBytes: 1 }).id;
    setClipGame(db, w, "Unused");
    setClipGame(db, w, null);
    expect(listGamesWithCounts(db).map((g) => [g.name, g.slug, g.clips])).toEqual([
      ["Apex", "apex", 2],
      ["Unused", "unused", 0],
      ["Valorant", "valorant", 1],
    ]);
  });
});

describe("tags", () => {
  it("merging a tag into one the clip already has leaves a single row", () => {
    // setClipTags lowercases, so the collision is set up by hand: two tag rows
    // on the same clip, as a legacy or hand-edited database could hold.
    db.insert(tags).values([{ id: "t-upper", name: "Clutch" }, { id: "t-lower", name: "clutch" }]).run();
    db.insert(clipTags).values([{ clipId, tagId: "t-upper" }, { clipId, tagId: "t-lower" }]).run();

    expect(mergeTags(db, "t-upper", "t-lower")).toBe(1);
    expect(db.select().from(clipTags).where(eq(clipTags.clipId, clipId)).all()).toEqual([{ clipId, tagId: "t-lower" }]);
    expect(getClipMetadata(db, clipId).tags).toEqual(["clutch"]);
    expect(listTagsWithCounts(db)).toEqual([{ id: "t-lower", name: "clutch", clips: 1 }]);
    expect(ids("clutch")).toEqual([clipId]);
  });

  it("merge moves clips that only had the source tag, and reindexes them", () => {
    setClipTags(db, clipId, ["clutchh"]);
    const other = createClip(db, { title: "y", originalFilename: "y.mp4", sizeBytes: 1 }).id;
    setClipTags(db, other, ["clutch"]);
    expect(mergeTags(db, tagId("clutchh"), tagId("clutch"))).toBe(1);
    expect(getClipMetadata(db, clipId).tags).toEqual(["clutch"]);
    expect(ids("clutchh")).toEqual([]);
  });

  it("refuses to merge a tag into itself", () => {
    setClipTags(db, clipId, ["ace"]);
    expect(() => mergeTags(db, tagId("ace"), tagId("ace"))).toThrow();
    expect(getClipMetadata(db, clipId).tags).toEqual(["ace"]);
  });

  it("renames (lowercased, like every tag) and refuses a taken name", () => {
    setClipTags(db, clipId, ["ace", "clutch"]);
    expect(renameTag(db, tagId("ace"), "Headshot")).toEqual({ ok: true });
    expect(getClipMetadata(db, clipId).tags).toEqual(["clutch", "headshot"]);
    expect(ids("headshot")).toEqual([clipId]);
    expect(renameTag(db, tagId("headshot"), "CLUTCH")).toMatchObject({ ok: false });
  });

  it("delete refuses when used, then forced detaches from clips", () => {
    setClipTags(db, clipId, ["ace"]);
    expect(deleteTag(db, tagId("ace"), { force: false })).toEqual({ ok: false, inUse: 1 });
    expect(deleteTag(db, tagId("ace"), { force: true })).toEqual({ ok: true, detached: 1 });
    expect(getClipMetadata(db, clipId).tags).toEqual([]);
    expect(ids("ace")).toEqual([]);
  });
});
