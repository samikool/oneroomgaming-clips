import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, deleteClipCascade, setClipStatus } from "@/db/clips";
import {
  addClip, collectionsForClip, createCollection, deleteCollection, getCollection,
  getMembership, listCollections, moveClip, removeClip, updateCollection,
} from "@/db/collections";

let db: Db;
let sam: string;
let kobe: string;
const clip = (t: string) => {
  const c = createClip(db, { title: t, originalFilename: `${t}.mp4`, sizeBytes: 1, uploaderId: sam });
  setClipStatus(db, c.id, "ready");
  return c.id;
};
const order = (id: string) => getCollection(db, id, sam)!.clips.map((c) => c.title);

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
});

describe("collections", () => {
  it("appends clips in order and ignores a second add", () => {
    const c = createCollection(db, sam, { name: "Best", open: false });
    const [a, b] = [clip("a"), clip("b")];
    expect(addClip(db, c.id, a, sam)).toBe("added");
    expect(addClip(db, c.id, b, sam)).toBe("added");
    expect(addClip(db, c.id, a, sam)).toBe("already");
    expect(order(c.id)).toEqual(["a", "b"]);
  });

  it("keeps positions dense after a remove and after a clip is deleted", () => {
    const c = createCollection(db, sam, { name: "Best", open: false });
    const [a, b, d] = [clip("a"), clip("b"), clip("d")];
    for (const x of [a, b, d]) addClip(db, c.id, x, sam);
    removeClip(db, c.id, b);
    expect(getCollection(db, c.id, sam)!.clips.map((x) => x.position)).toEqual([0, 1]);
    deleteClipCascade(db, a);
    expect(getCollection(db, c.id, sam)!.clips.map((x) => [x.title, x.position])).toEqual([["d", 0]]);
  });

  it("re-densifies every collection a deleted clip was in", () => {
    const one = createCollection(db, sam, { name: "One", open: false });
    const two = createCollection(db, kobe, { name: "Two", open: false });
    const [a, b] = [clip("a"), clip("b")];
    for (const c of [one, two]) {
      addClip(db, c.id, a, sam);
      addClip(db, c.id, b, sam);
    }
    deleteClipCascade(db, a);
    for (const c of [one, two]) {
      expect(getCollection(db, c.id, sam)!.clips.map((x) => [x.title, x.position])).toEqual([["b", 0]]);
    }
  });

  it("moves a clip to the start, the end, and nowhere", () => {
    const c = createCollection(db, sam, { name: "Best", open: false });
    const ids = ["a", "b", "c"].map(clip);
    ids.forEach((x) => addClip(db, c.id, x, sam));
    expect(moveClip(db, c.id, ids[2], 0)).toBe(true);
    expect(order(c.id)).toEqual(["c", "a", "b"]);
    expect(moveClip(db, c.id, ids[2], 2)).toBe(true);
    expect(order(c.id)).toEqual(["a", "b", "c"]);
    expect(moveClip(db, c.id, ids[0], 0)).toBe(false);
    expect(moveClip(db, c.id, "nope", 0)).toBe(false);
  });

  it("bumps updatedAt and lists newest updated first", async () => {
    const one = createCollection(db, sam, { name: "One", open: false });
    const two = createCollection(db, sam, { name: "Two", open: false });
    await Bun.sleep(2);
    addClip(db, one.id, clip("a"), sam);
    expect(listCollections(db, {}).map((x) => x.name)).toEqual(["One", "Two"]);
    expect(listCollections(db, { ownerId: kobe })).toEqual([]);
    expect(two.clipCount).toBe(0);
  });

  it("offers only collections the user may add to, flagged when they hold the clip", () => {
    const mine = createCollection(db, sam, { name: "Mine", open: false });
    const open = createCollection(db, sam, { name: "Open", open: true });
    const a = clip("a");
    addClip(db, open.id, a, sam);
    expect(collectionsForClip(db, a, kobe).map((x) => [x.name, x.contains])).toEqual([["Open", true]]);
    expect(collectionsForClip(db, a, sam).map((x) => x.name).sort()).toEqual(["Mine", "Open"]);
    updateCollection(db, mine.id, { name: "Renamed" });
    deleteCollection(db, open.id);
    expect(collectionsForClip(db, a, sam).map((x) => x.name)).toEqual(["Renamed"]);
  });

  it("summarises owner, count, the first four thumbs and who added each clip", () => {
    const c = createCollection(db, sam, { name: "Best", open: true, description: " desc " });
    const ids = ["a", "b", "c", "d", "e"].map(clip);
    ids.forEach((x, i) => addClip(db, c.id, x, i === 4 ? kobe : sam));
    const [summary] = listCollections(db, {});
    expect(summary).toMatchObject({ owner: "sam", clipCount: 5, open: true, description: "desc" });
    expect(summary.thumbs).toHaveLength(4);
    expect(getCollection(db, c.id, sam)!.clips.at(-1)!.addedBy).toBe("kobe");
    expect(getMembership(db, c.id, ids[4])).toEqual({ addedBy: kobe });
    expect(getCollection(db, "nope", sam)).toBeUndefined();
  });
});
