import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, setClipStatus } from "@/db/clips";
import { addComment } from "@/db/comments";
import { like } from "@/db/likes";
import { users, type User } from "@/db/schema";
import { sinceLastVisit } from "@/db/since";

const H = 60 * 60 * 1000;
const T = Date.UTC(2026, 8, 26);

let db: Db;
let sam: User;
let kobe: User;

function samAfterGap(): User {
  // First visit at T, back three hours later: the previous visit started at T.
  return upsertUser(db, { username: "sam", email: null, displayName: null }, new Date(T + 3 * H));
}

function readyClip(uploaderId: string, at: number, title = "c"): string {
  const id = createClip(db, { title, originalFilename: "x.mp4", sizeBytes: 1, uploaderId }, new Date(at)).id;
  setClipStatus(db, id, "ready");
  return id;
}

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }, new Date(T));
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }, new Date(T));
});

describe("sinceLastVisit", () => {
  it("is null on the first visit", () => {
    readyClip(kobe.id, T + H);
    expect(sinceLastVisit(db, sam)).toBeNull();
  });

  it("counts other people's new clips since the previous visit, newest first", () => {
    readyClip(kobe.id, T - H, "old");
    const a = readyClip(kobe.id, T + H);
    const b = readyClip(kobe.id, T + 2 * H);
    readyClip(sam.id, T + 2 * H, "mine");
    const me = samAfterGap();

    const result = sinceLastVisit(db, me);
    expect(result?.since).toBe(T);
    expect(result?.newClipCount).toBe(2);
    expect(result?.newClips.map((c) => c.id)).toEqual([b, a]);
  });

  it("caps the thumbnail row at 8", () => {
    for (let i = 1; i <= 10; i++) readyClip(kobe.id, T + i * 1000);
    const result = sinceLastVisit(db, samAfterGap());
    expect(result?.newClipCount).toBe(10);
    expect(result?.newClips).toHaveLength(8);
  });

  it("counts likes and comments on your clips since then, not your own", () => {
    const mine = createClip(db, { title: "m", originalFilename: "m.mp4", sizeBytes: 1, uploaderId: sam.id }, new Date(T - 5 * H)).id;
    like(db, kobe.id, mine, T + H);
    addComment(db, { clipId: mine, userId: kobe.id, body: "gg" });
    addComment(db, { clipId: mine, userId: sam.id, body: "ty" });
    // Comments are stamped with the wall clock; put the visit window around it.
    db.update(users).set({ lastSeenAt: new Date(T), visitStartedAt: new Date(T) }).where(eq(users.id, sam.id)).run();
    const me = upsertUser(db, { username: "sam", email: null, displayName: null }, new Date(Date.now() + 3 * H));

    const result = sinceLastVisit(db, me);
    expect(result).toMatchObject({ likes: 1, comments: 1, newClipCount: 0 });
  });

  it("is null when nothing happened", () => {
    expect(sinceLastVisit(db, samAfterGap())).toBeNull();
  });
});
