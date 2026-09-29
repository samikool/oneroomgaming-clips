import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { setClipGame } from "@/db/metadata";
import { games } from "@/db/schema";
import { upsertUser } from "@/db/users";
import type { Igdb } from "@/lib/igdb";
import { plausibleRecordedAt } from "@/lib/media/recorded";
import { resolveUploadMeta } from "./meta";

let db: Db;
const env = { MEDIA_ROOT: "/tmp/never-written" };
const now = Date.UTC(2026, 8, 28);
const igdb = (fail = false): Igdb => ({
  search: async () => [],
  getGame: async (id) => {
    if (fail) throw new Error("down");
    return { igdbId: id, name: "Valorant", year: 2020, coverImageId: null };
  },
  downloadCover: async () => {},
});

beforeEach(() => {
  db = createDb(":memory:");
  upsertUser(db, { username: "sam", email: null, displayName: null });
  upsertUser(db, { username: "ben", email: null, displayName: null });
});

describe("plausibleRecordedAt", () => {
  it("takes 2000 onwards up to a day ahead", () => {
    expect(plausibleRecordedAt(Date.UTC(1999, 11, 31), now)).toBe(false);
    expect(plausibleRecordedAt(Date.UTC(2022, 1, 17), now)).toBe(true);
    expect(plausibleRecordedAt(now + 2 * 86_400_000, now)).toBe(false);
    expect(plausibleRecordedAt(Number.NaN, now)).toBe(false);
  });
});

describe("resolveUploadMeta", () => {
  it("returns nothing for nothing", async () => {
    expect(await resolveUploadMeta(db, env, null, {}, now)).toEqual({});
  });

  it("normalizes tags, keeps known people, and checks the date", async () => {
    expect(await resolveUploadMeta(db, env, null, {
      tags: " Ace , clutch,ace,, ", people: "sam,ghost, ben", recordedAt: String(Date.UTC(2022, 1, 17)),
    }, now)).toEqual({ tags: "ace,clutch", people: "ben,sam", recordedAt: String(Date.UTC(2022, 1, 17)) });
    expect(await resolveUploadMeta(db, env, null, { recordedAt: "123" }, now)).toEqual({});
    expect(await resolveUploadMeta(db, env, null, { recordedAt: "soon" }, now)).toEqual({});
  });

  it("caps tags and people at 20", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
    const out = await resolveUploadMeta(db, env, null, { tags: many }, now);
    expect(out.tags.split(",")).toHaveLength(20);
  });

  it("accepts an existing local game and refuses an unknown one", async () => {
    setClipGame(db, createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 }).id, "Apex");
    const id = db.select().from(games).get()!.id;
    expect(await resolveUploadMeta(db, env, null, { game: `local:${id}` }, now)).toEqual({ gameId: id });
    expect(await resolveUploadMeta(db, env, null, { game: "local:01ARZ3NDEKTSV4RRFFQ69G5FAV" }, now)).toEqual({});
  });

  it("keeps a free-text game name for finish to create", async () => {
    expect(await resolveUploadMeta(db, env, null, { game: "text: Custom Night " }, now)).toEqual({ gameName: "Custom Night" });
    expect(await resolveUploadMeta(db, env, null, { game: `text:${"x".repeat(65)}` }, now)).toEqual({});
  });

  it("resolves an IGDB game, and drops it when IGDB fails or is off", async () => {
    const out = await resolveUploadMeta(db, env, igdb(), { game: "igdb:126459" }, now);
    expect(db.select().from(games).get()).toMatchObject({ id: out.gameId, igdbId: 126459, name: "Valorant" });
    expect(await resolveUploadMeta(db, env, igdb(true), { game: "igdb:1" }, now)).toEqual({});
    expect(await resolveUploadMeta(db, env, null, { game: "igdb:1" }, now)).toEqual({});
    expect(await resolveUploadMeta(db, env, igdb(), { game: "igdb:abc" }, now)).toEqual({});
  });
});

describe("resolveUploadMeta, second pass", () => {
  it("matches people case-insensitively", async () => {
    expect(await resolveUploadMeta(db, env, null, { people: "Sam,BEN" }, now)).toEqual({ people: "ben,sam" });
  });

  it("uses a game already linked to the IGDB entry without asking IGDB again", async () => {
    let calls = 0;
    const counting: Igdb = { ...igdb(), getGame: async (id) => { calls += 1; return igdb().getGame(id); } };
    const first = await resolveUploadMeta(db, env, counting, { game: "igdb:126459" }, now);
    const second = await resolveUploadMeta(db, env, igdb(true), { game: "igdb:126459" }, now);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });
});
