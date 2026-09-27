import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { addComment } from "@/db/comments";
import { listNotifications, markRead, notify, retractLike, unreadCount } from "@/db/notifications";

let db: Db;
let sam: string;
let clipId: string;
const DAY = 86_400_000;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  for (const u of ["kobe", "pat", "lee"]) upsertUser(db, { username: u, email: null, displayName: null });
  clipId = createClip(db, { title: "did_i_get_him", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

describe("notify", () => {
  it("groups unread likes on one clip, newest actor first", () => {
    notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 });
    const n = notify(db, { recipientId: sam, type: "like", clipId, actor: "pat", now: 2 })!;
    expect(n.actors).toEqual(["pat", "kobe"]);
    expect(n.clipTitle).toBe("did_i_get_him");
    expect(listNotifications(db, sam)).toHaveLength(1);
    expect(unreadCount(db, sam)).toBe(1);
  });

  it("moves a repeat actor to the front instead of duplicating", () => {
    notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 });
    notify(db, { recipientId: sam, type: "like", clipId, actor: "pat", now: 2 });
    expect(notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 3 })!.actors).toEqual(["kobe", "pat"]);
  });

  it("starts a new group after the old one was read", () => {
    const first = notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 })!;
    markRead(db, sam, [first.id], 2);
    notify(db, { recipientId: sam, type: "like", clipId, actor: "pat", now: 3 });
    expect(listNotifications(db, sam).map((x) => x.actors)).toEqual([["pat"], ["kobe"]]);
  });

  it("never groups mentions", () => {
    notify(db, { recipientId: sam, type: "mention", clipId, actor: "kobe", source: "chat", now: 1 });
    notify(db, { recipientId: sam, type: "mention", clipId, actor: "pat", source: "chat", now: 2 });
    expect(listNotifications(db, sam)).toHaveLength(2);
  });

  it("prunes the recipient's notifications older than 90 days on write", () => {
    notify(db, { recipientId: sam, type: "tagged", clipId, actor: "kobe", now: 0 });
    notify(db, { recipientId: sam, type: "like", clipId, actor: "pat", now: 91 * DAY });
    expect(listNotifications(db, sam).map((x) => x.type)).toEqual(["like"]);
  });

  it("carries a cut excerpt of the comment", () => {
    const kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
    const comment = addComment(db, { clipId, userId: kobe, body: "x".repeat(100) });
    const n = notify(db, { recipientId: sam, type: "comment", clipId, actor: "kobe", commentId: comment.id, source: "comment", now: 1 })!;
    expect(n.excerpt).toBe(`${"x".repeat(80)}…`);
    expect(n.commentId).toBe(comment.id);
  });
});

describe("retractLike", () => {
  it("removes the actor from an unread group, and deletes an empty one", () => {
    notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 });
    notify(db, { recipientId: sam, type: "like", clipId, actor: "pat", now: 2 });
    expect(retractLike(db, { recipientId: sam, clipId, actor: "pat" })).toMatchObject({ actors: ["kobe"] });
    expect(retractLike(db, { recipientId: sam, clipId, actor: "kobe" })).toBe("deleted");
    expect(listNotifications(db, sam)).toHaveLength(0);
  });

  it("leaves a read notification alone", () => {
    const n = notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 })!;
    markRead(db, sam, [n.id], 2);
    expect(retractLike(db, { recipientId: sam, clipId, actor: "kobe" })).toBeNull();
    expect(listNotifications(db, sam)[0].actors).toEqual(["kobe"]);
  });
});

describe("listNotifications", () => {
  it("pages by updatedAt", () => {
    for (let i = 1; i <= 5; i++) notify(db, { recipientId: sam, type: "mention", clipId, actor: "kobe", now: i });
    const first = listNotifications(db, sam, { limit: 2 });
    expect(first.map((n) => n.updatedAt)).toEqual([5, 4]);
    expect(listNotifications(db, sam, { before: 4, limit: 2 }).map((n) => n.updatedAt)).toEqual([3, 2]);
  });
});

describe("markRead", () => {
  it("only marks the recipient's own notifications", () => {
    const n = notify(db, { recipientId: sam, type: "like", clipId, actor: "kobe", now: 1 })!;
    const kobeId = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
    markRead(db, kobeId, [n.id]);
    expect(unreadCount(db, sam)).toBe(1);
    markRead(db, sam, [n.id]);
    expect(unreadCount(db, sam)).toBe(0);
  });
});
