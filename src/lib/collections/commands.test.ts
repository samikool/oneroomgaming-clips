import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { addClip, createCollection, getCollection } from "@/db/collections";
import type { User } from "@/db/schema";
import {
  addToCollectionCommand,
  createCollectionCommand,
  createCollectionWithClipCommand,
  deleteCollectionCommand,
  moveInCollectionCommand,
  removeFromCollectionCommand,
  setCollectionOpenCommand,
  updateCollectionCommand,
} from "./commands";

let db: Db;
let sam: User;
let kobe: User;
let clipA: string;
let clipB: string;

const DENIED = { ok: false, error: "You can't do that to this collection." };

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null });
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null });
  clipA = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 }).id;
  clipB = createClip(db, { title: "b", originalFilename: "b.mp4", sizeBytes: 1 }).id;
});

describe("collection commands", () => {
  it("creates with the actor as owner and reports field errors", () => {
    const made = createCollectionCommand(db, sam, { name: " Best ", description: "", open: false });
    expect(made).toMatchObject({ ok: true });
    expect(getCollection(db, (made as { id: string }).id, sam.id)).toMatchObject({ owner: "sam", name: "Best" });
    expect(createCollectionCommand(db, sam, { name: "", description: "", open: false })).toMatchObject({
      ok: false,
      fields: { name: expect.any(String) },
    });
  });

  it("refuses a non-owner editing, toggling, reordering or deleting", () => {
    const c = createCollection(db, sam.id, { name: "Best", open: true });
    addClip(db, c.id, clipA, sam.id);
    addClip(db, c.id, clipB, sam.id);
    expect(updateCollectionCommand(db, kobe, c.id, { name: "Mine now" })).toEqual(DENIED);
    expect(setCollectionOpenCommand(db, kobe, c.id, false)).toEqual(DENIED);
    expect(moveInCollectionCommand(db, kobe, c.id, clipB, 0)).toEqual(DENIED);
    expect(deleteCollectionCommand(db, kobe, c.id)).toEqual(DENIED);
    expect(getCollection(db, c.id, sam.id)).toMatchObject({ name: "Best", open: true });
  });

  it("lets anyone add to an open collection but not a closed one", () => {
    const closed = createCollection(db, sam.id, { name: "Closed", open: false });
    const open = createCollection(db, sam.id, { name: "Open", open: true });
    expect(addToCollectionCommand(db, kobe, closed.id, clipA)).toEqual(DENIED);
    expect(addToCollectionCommand(db, kobe, open.id, clipA)).toEqual({ ok: true });
  });

  it("refuses a non-owner removing a clip someone else added, even in an open collection", () => {
    const c = createCollection(db, sam.id, { name: "Open", open: true });
    addClip(db, c.id, clipA, sam.id);
    addClip(db, c.id, clipB, kobe.id);
    expect(removeFromCollectionCommand(db, kobe, c.id, clipA)).toEqual(DENIED);
    expect(removeFromCollectionCommand(db, kobe, c.id, clipB)).toEqual({ ok: true });
    expect(getCollection(db, c.id, sam.id)!.clips.map((x) => x.title)).toEqual(["a"]);
  });

  it("lets the owner do everything", () => {
    const c = createCollection(db, sam.id, { name: "Open", open: true });
    addClip(db, c.id, clipA, kobe.id);
    addClip(db, c.id, clipB, kobe.id);
    expect(moveInCollectionCommand(db, sam, c.id, clipB, 0)).toEqual({ ok: true });
    expect(removeFromCollectionCommand(db, sam, c.id, clipA)).toEqual({ ok: true });
    expect(setCollectionOpenCommand(db, sam, c.id, false)).toEqual({ ok: true });
    expect(updateCollectionCommand(db, sam, c.id, { name: "Renamed", description: "d" })).toEqual({ ok: true });
    expect(deleteCollectionCommand(db, sam, c.id)).toEqual({ ok: true });
    expect(getCollection(db, c.id, sam.id)).toBeUndefined();
  });

  it("reports a missing collection or clip instead of throwing", () => {
    expect(addToCollectionCommand(db, sam, "nope", clipA)).toMatchObject({ ok: false });
    const c = createCollection(db, sam.id, { name: "Best", open: false });
    expect(addToCollectionCommand(db, sam, c.id, "nope")).toMatchObject({ ok: false });
  });

  it("creates a collection with the clip already in it", () => {
    const made = createCollectionWithClipCommand(db, kobe, "Kobe fails", clipA);
    expect(made).toMatchObject({ ok: true });
    const detail = getCollection(db, (made as { id: string }).id, kobe.id)!;
    expect(detail).toMatchObject({ owner: "kobe", open: false, clipCount: 1 });
    expect(detail.clips[0].addedBy).toBe("kobe");
  });
});
