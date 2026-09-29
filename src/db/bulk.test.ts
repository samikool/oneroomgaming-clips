import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { createClip, deleteClipCascade } from "@/db/clips";
import { getClipMetadata, setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";
import { games } from "@/db/schema";
import { searchClipIds } from "@/db/search";
import { upsertUser } from "@/db/users";
import { applyBulkEdit, selectionSummary } from "./bulk";

let db: Db;
const none = { addTags: [], removeTags: [], addPeople: [], removePeople: [] };
const clip = (title: string) => createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1 }).id;

beforeEach(() => {
  db = createDb(":memory:");
  for (const u of ["sam", "ben", "kobe"]) upsertUser(db, { username: u, email: null, displayName: null });
});

describe("applyBulkEdit", () => {
  it("adds tags without touching others' and removes only where present", () => {
    const a = clip("a");
    const b = clip("b");
    setClipTags(db, a, ["ace", "funny"]);
    setClipTags(db, b, ["clutch"]);
    applyBulkEdit(db, [a, b], { ...none, game: { op: "leave" }, addTags: ["clutch", "new"], removeTags: ["ace"] });
    expect(getClipMetadata(db, a).tags).toEqual(["clutch", "funny", "new"]);
    expect(getClipMetadata(db, b).tags).toEqual(["clutch", "new"]);
  });

  it("adds and removes people, reporting who was newly added where", () => {
    const a = clip("a");
    const b = clip("b");
    setClipParticipants(db, a, ["ben", "kobe"]);
    const out = applyBulkEdit(db, [a, b], { ...none, game: { op: "leave" }, addPeople: ["ben", "ghost"], removePeople: ["kobe"] });
    expect(getClipMetadata(db, a).participants).toEqual(["ben"]);
    expect(getClipMetadata(db, b).participants).toEqual(["ben"]);
    expect([...out.added]).toEqual([["ben", [b]]]);
  });

  it("sets, clears or leaves the game", () => {
    const a = clip("a");
    const b = clip("b");
    setClipGame(db, a, "Apex");
    applyBulkEdit(db, [a, b], { ...none, game: { op: "name", name: "Valorant" } });
    expect(getClipMetadata(db, a).game?.name).toBe("Valorant");
    expect(getClipMetadata(db, b).game?.name).toBe("Valorant");
    const apex = db.select().from(games).where(eq(games.name, "Apex")).get()!.id;
    applyBulkEdit(db, [a], { ...none, game: { op: "id", gameId: apex } });
    expect(getClipMetadata(db, a).game?.name).toBe("Apex");
    applyBulkEdit(db, [a], { ...none, game: { op: "leave" } });
    expect(getClipMetadata(db, a).game?.name).toBe("Apex");
    applyBulkEdit(db, [a, b], { ...none, game: { op: "clear" } });
    expect(getClipMetadata(db, a).game).toBeNull();
  });

  it("skips clips that are gone and a game that is gone", () => {
    const a = clip("a");
    const b = clip("b");
    deleteClipCascade(db, b);
    const out = applyBulkEdit(db, [a, b], { ...none, game: { op: "id", gameId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, addTags: ["ace"] });
    expect(out).toMatchObject({ updated: [a], skipped: 1 });
    expect(getClipMetadata(db, a)).toMatchObject({ tags: ["ace"], game: null });
  });

  it("reports people it doesn't recognise", () => {
    const a = clip("a");
    const out = applyBulkEdit(db, [a], { ...none, game: { op: "leave" }, addPeople: ["ben", "kobee"] });
    expect(out.unknownPeople).toEqual(["kobee"]);
  });

  it("reindexes search", () => {
    const a = clip("a");
    applyBulkEdit(db, [a], { ...none, game: { op: "leave" }, addTags: ["zebra"] });
    expect([...(searchClipIds(db, "zebra") ?? [])]).toEqual([a]);
  });
});

describe("selectionSummary", () => {
  it("counts games, tags and people across existing clips", () => {
    const a = clip("a");
    const b = clip("b");
    const c = clip("c");
    setClipGame(db, a, "Apex");
    setClipGame(db, b, "Apex");
    setClipTags(db, a, ["ace"]);
    setClipTags(db, c, ["ace", "clutch"]);
    setClipParticipants(db, b, ["ben"]);
    const s = selectionSummary(db, [a, b, c, "01ARZ3NDEKTSV4RRFFQ69G5FAV"]);
    expect(s.total).toBe(3);
    expect(s.games).toEqual([
      { id: expect.any(String), name: "Apex", count: 2 },
      { id: null, name: "", count: 1 },
    ]);
    expect(s.tags).toEqual([{ name: "ace", count: 2 }, { name: "clutch", count: 1 }]);
    expect(s.people).toEqual([{ username: "ben", count: 1 }]);
  });
});
