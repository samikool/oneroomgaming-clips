import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { addComment } from "@/db/comments";
import { activityScores, recordActivity, recordView } from "@/db/activity";
import { like } from "@/db/likes";
import { activity } from "@/db/schema";
import { HALF_LIFE_MS } from "@/lib/activity/scoring";

let db: Db;
let sam: string;
let kobe: string;
let clipId: string;
const T = Date.UTC(2026, 8, 26);

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
  clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

describe("recordView", () => {
  it("counts once per person per clip per 30 minutes", () => {
    expect(recordView(db, kobe, clipId, T)).toBe(true);
    expect(recordView(db, kobe, clipId, T + 10 * 60_000)).toBe(false);
    expect(recordView(db, kobe, clipId, T + 31 * 60_000)).toBe(true);
    expect(db.select().from(activity).all()).toHaveLength(2);
  });
});

describe("recordActivity", () => {
  it("drops events for a clip that no longer exists", () => {
    expect(recordActivity(db, { type: "reaction", userId: kobe, clipId: "GONE", at: T })).toBe(false);
  });
});

describe("addComment", () => {
  it("records a comment activity alongside the comment", () => {
    addComment(db, { clipId, userId: kobe, body: "nice" });
    expect(db.select().from(activity).all().map((r) => r.type)).toEqual(["comment"]);
  });
});

describe("activityScores", () => {
  it("weights and decays, and ignores the uploader's own activity", () => {
    recordView(db, kobe, clipId, T); // 1
    recordActivity(db, { type: "theater_play", userId: kobe, clipId, at: T }); // 2
    recordView(db, sam, clipId, T); // the uploader, so ignored
    like(db, kobe, clipId, T); // 4
    expect(activityScores(db).trending([clipId], T).get(clipId)).toBeCloseTo(7);
    expect(activityScores(db).trending([clipId], T + HALF_LIFE_MS).get(clipId)).toBeCloseTo(3.5);
  });

  it("reports likes, total activity and who liked", () => {
    like(db, kobe, clipId, T);
    recordView(db, kobe, clipId, T);
    expect(activityScores(db).likes([clipId]).get(clipId)).toBe(1);
    expect(activityScores(db).activity([clipId]).get(clipId)).toBe(1);
    expect(activityScores(db).likedBy(kobe, [clipId]).has(clipId)).toBe(true);
    expect(activityScores(db).likedBy(sam, [clipId]).has(clipId)).toBe(false);
  });
});
