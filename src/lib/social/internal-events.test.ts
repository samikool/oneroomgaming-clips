import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { activity } from "@/db/schema";
import { handleInternalEvent } from "./internal-events";

beforeAll(() => {
  delete process.env.REALTIME_URL;
});

let db: Db;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  upsertUser(db, { username: "kobe", email: null, displayName: null });
  clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
});

function post(body: unknown, secret: string | null = "s"): Request {
  return new Request("http://web/api/internal/events", {
    method: "POST",
    headers: secret === null ? {} : { "X-Emit-Secret": secret },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleInternalEvent", () => {
  it("rejects a bad or missing signature", async () => {
    const play = { kind: "theater.play", user: "kobe", clipId, at: 1 };
    expect((await handleInternalEvent(post(play, "wrong"), { db, secret: "s" })).status).toBe(401);
    expect((await handleInternalEvent(post(play, null), { db, secret: "s" })).status).toBe(401);
    expect((await handleInternalEvent(post(play), { db, secret: undefined })).status).toBe(401);
    expect(db.select().from(activity).all()).toHaveLength(0);
  });

  it("answers 400 to a malformed body", async () => {
    expect((await handleInternalEvent(post("not json"), { db, secret: "s" })).status).toBe(400);
    expect((await handleInternalEvent(post({ kind: "nope" }), { db, secret: "s" })).status).toBe(400);
  });

  it("drops an unknown clip or user with 204 and stores nothing", async () => {
    expect((await handleInternalEvent(post({ kind: "theater.play", user: "kobe", clipId: "GONE", at: 1 }), { db, secret: "s" })).status).toBe(204);
    expect((await handleInternalEvent(post({ kind: "theater.play", user: "ghost", clipId, at: 1 }), { db, secret: "s" })).status).toBe(204);
    expect(db.select().from(activity).all()).toHaveLength(0);
  });

  it("accepts each event type", async () => {
    for (const event of [
      { kind: "theater.play", user: "kobe", clipId, at: 1 },
      { kind: "theater.reaction", user: "kobe", clipId, emoji: "🔥", at: 2 },
      { kind: "theater.chat", user: "kobe", clipId, body: "hi @sam", at: 3 },
    ]) {
      expect((await handleInternalEvent(post(event), { db, secret: "s" })).status).toBe(204);
    }
    expect(db.select().from(activity).all().map((r) => r.type).sort()).toEqual(["reaction", "theater_play"]);
  });
});
