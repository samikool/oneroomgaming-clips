import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { like, likeCount, likers, unlike } from "@/db/likes";

let db: Db;
let sam: string;
let kobe: string;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
  clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

describe("likes", () => {
  it("is idempotent", () => {
    expect(like(db, kobe, clipId)).toBe("liked");
    expect(like(db, kobe, clipId)).toBe("already");
    expect(likeCount(db, clipId)).toBe(1);
  });

  it("refuses your own clip and missing clips", () => {
    expect(like(db, sam, clipId)).toBe("own");
    expect(like(db, kobe, "GONE")).toBe("missing");
  });

  it("unlikes, and unliking again does nothing", () => {
    like(db, kobe, clipId);
    expect(unlike(db, kobe, clipId)).toBe(true);
    expect(unlike(db, kobe, clipId)).toBe(false);
    expect(likeCount(db, clipId)).toBe(0);
  });

  it("lists who liked, newest first", () => {
    const pat = upsertUser(db, { username: "pat", email: null, displayName: null }).id;
    like(db, kobe, clipId, 1);
    like(db, pat, clipId, 2);
    expect(likers(db, clipId).map((l) => l.username)).toEqual(["pat", "kobe"]);
  });
});
