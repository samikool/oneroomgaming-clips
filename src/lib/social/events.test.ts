import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, setClipStatus } from "@/db/clips";
import { setClipParticipants } from "@/db/metadata";
import { addComment } from "@/db/comments";
import { likeCount } from "@/db/likes";
import { listNotifications } from "@/db/notifications";
import { onClipReady, onComment, onLike, onParticipantsChanged, onTheaterEvent, onUnlike } from "./events";

// Keep publish offline: with no REALTIME_URL it returns false without a request.
// (mock.module would leak into publish.test.ts, which runs in the same process.)
beforeAll(() => {
  delete process.env.REALTIME_URL;
});

let db: Db;
let sam: string;
let kobe: string;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
  upsertUser(db, { username: "pat", email: null, displayName: null });
  clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

describe("social events", () => {
  it("a double like makes one like and one actor", async () => {
    await Promise.all([onLike(db, kobe, clipId), onLike(db, kobe, clipId)]);
    const [n] = listNotifications(db, sam);
    expect(n.actors).toEqual(["kobe"]);
    expect(likeCount(db, clipId)).toBe(1);
  });

  it("refuses a like on your own clip without notifying", async () => {
    expect((await onLike(db, sam, clipId)).status).toBe("own");
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("unlike retracts from the unread group", async () => {
    await onLike(db, kobe, clipId);
    expect((await onUnlike(db, kobe, clipId)).count).toBe(0);
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("unlike after the notification was read leaves it, and a re-like starts a new group", async () => {
    await onLike(db, kobe, clipId);
    const { markRead } = await import("@/db/notifications");
    markRead(db, sam, listNotifications(db, sam).map((n) => n.id));
    await onUnlike(db, kobe, clipId);
    expect(listNotifications(db, sam)).toHaveLength(1);
    await onLike(db, kobe, clipId);
    expect(listNotifications(db, sam).map((n) => n.read)).toEqual([false, true]);
  });

  it("a comment mentioning pat gives pat a mention and sam a comment notification", async () => {
    await onComment(db, addComment(db, { clipId, userId: kobe, body: "look @pat" }));
    const patId = upsertUser(db, { username: "pat", email: null, displayName: null }).id;
    expect(listNotifications(db, patId).map((n) => n.type)).toEqual(["mention"]);
    expect(listNotifications(db, sam).map((n) => n.type)).toEqual(["comment"]);
  });

  it("your own comment on your own clip mentioning yourself notifies nobody", async () => {
    await onComment(db, addComment(db, { clipId, userId: sam, body: "me @sam" }));
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("a theater play records activity; a chat mention notifies; unknown clip is dropped", async () => {
    expect(await onTheaterEvent(db, { kind: "theater.play", user: "kobe", clipId, at: 1 })).toBe(true);
    expect(await onTheaterEvent(db, { kind: "theater.play", user: "kobe", clipId: "GONE", at: 1 })).toBe(false);
    await onTheaterEvent(db, { kind: "theater.chat", user: "kobe", clipId, body: "yo @sam", at: 2 });
    expect(listNotifications(db, sam).map((n) => [n.type, n.source])).toEqual([["mention", "chat"]]);
  });

  it("drops theater events from unknown users, and reactions and chat about a gone clip", async () => {
    expect(await onTheaterEvent(db, { kind: "theater.play", user: "ghost", clipId, at: 1 })).toBe(false);
    expect(await onTheaterEvent(db, { kind: "theater.reaction", user: "kobe", clipId: null, emoji: "🔥", at: 1 })).toBe(false);
    expect(await onTheaterEvent(db, { kind: "theater.reaction", user: "kobe", clipId, emoji: "🔥", at: 1 })).toBe(true);
    expect(await onTheaterEvent(db, { kind: "theater.chat", user: "kobe", clipId: "GONE", body: "@sam", at: 1 })).toBe(false);
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("tagging notifies only the newly added", async () => {
    setClipStatus(db, clipId, "ready");
    await onClipReady(db, clipId); // every ready clip has had its pass
    await onParticipantsChanged(db, clipId, "sam", ["kobe"], ["kobe", "pat"]);
    const patId = upsertUser(db, { username: "pat", email: null, displayName: null }).id;
    expect(listNotifications(db, patId).map((n) => n.type)).toEqual(["tagged"]);
    expect(listNotifications(db, kobe)).toHaveLength(0);
  });
});

describe("people notifications wait for ready", () => {
  it("edits while processing notify nobody; ready notifies everyone then in People, once", async () => {
    setClipStatus(db, clipId, "processing");
    setClipParticipants(db, clipId, ["kobe"]);
    await onParticipantsChanged(db, clipId, "sam", [], ["kobe"]);
    expect(listNotifications(db, kobe)).toHaveLength(0);

    setClipParticipants(db, clipId, ["kobe", "pat"]);
    setClipStatus(db, clipId, "ready");
    await onClipReady(db, clipId);
    expect(listNotifications(db, kobe).map((n) => n.type)).toEqual(["tagged"]);
    expect(listNotifications(db, kobe)[0].actors).toEqual(["sam"]);

    await onClipReady(db, clipId); // a reprocess reaching ready again
    expect(listNotifications(db, kobe)).toHaveLength(1);
  });

  it("never notifies the uploader about their own clip", async () => {
    setClipStatus(db, clipId, "processing");
    setClipParticipants(db, clipId, ["sam"]);
    setClipStatus(db, clipId, "ready");
    await onClipReady(db, clipId);
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("a normal edit on a ready clip still notifies right away", async () => {
    setClipStatus(db, clipId, "ready");
    await onClipReady(db, clipId); // every ready clip has had its pass
    await onParticipantsChanged(db, clipId, "sam", [], ["kobe"]);
    expect(listNotifications(db, kobe)).toHaveLength(1);
  });
});

describe("tagging during a reprocess", () => {
  it("notifies right away once the clip's ready pass has run", async () => {
    setClipStatus(db, clipId, "ready");
    await onClipReady(db, clipId);
    setClipStatus(db, clipId, "pending"); // an admin reprocess
    await onParticipantsChanged(db, clipId, "sam", [], ["kobe"]);
    expect(listNotifications(db, kobe).map((n) => n.type)).toEqual(["tagged"]);
  });
});
