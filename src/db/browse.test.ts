import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, setClipStatus } from "@/db/clips";
import { setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";
import { browseClips, zeroScores, type Scores } from "@/db/browse";
import { parseBrowseQuery } from "@/lib/browse/query";

let db: Db;
let sam: string;
let kobe: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
});

function clip(title: string, at: number, { uploader = sam, ready = true } = {}) {
  const c = createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1, uploaderId: uploader }, new Date(at));
  if (ready) setClipStatus(db, c.id, "ready");
  return c;
}

const q = (params: Record<string, string | string[]>) => parseBrowseQuery(params);
const titles = (r: { clips: { title: string }[] }) => r.clips.map((c) => c.title);
const browse = (params: Record<string, string | string[]>, extra: Partial<Parameters<typeof browseClips>[2]> = {}) =>
  browseClips(db, q(params), { scope: "home", userId: sam, ...extra });

describe("browseClips", () => {
  it("New is newest first and shows processing clips on home only", () => {
    clip("old", 1);
    clip("new", 2);
    clip("processing", 3, { ready: false });
    expect(titles(browse({}))).toEqual(["processing", "new", "old"]);
    expect(titles(browse({}, { scope: "theater" }))).toEqual(["new", "old"]);
    expect(titles(browse({ sort: "random", seed: "1" }))).not.toContain("processing");
  });

  it("filters OR within a field and AND across fields", () => {
    const a = clip("a", 1); setClipGame(db, a.id, "Apex"); setClipTags(db, a.id, ["ace"]);
    const b = clip("b", 2); setClipGame(db, b.id, "Valorant"); setClipTags(db, b.id, ["ace"]);
    const c = clip("c", 3); setClipGame(db, c.id, "Valorant");
    expect(titles(browse({ game: ["apex", "valorant"] }))).toEqual(["c", "b", "a"]);
    expect(titles(browse({ game: ["apex", "valorant"], tag: "ace" }))).toEqual(["b", "a"]);
  });

  it("shows a multi-tag clip once", () => {
    const a = clip("multi", 1);
    setClipTags(db, a.id, ["ace", "clutch"]);
    expect(titles(browse({ tag: ["ace", "clutch"] }))).toEqual(["multi"]);
  });

  it("people matches uploader or participant", () => {
    clip("by kobe", 1, { uploader: kobe });
    const withKobe = clip("with kobe", 2);
    setClipParticipants(db, withKobe.id, ["kobe"]);
    clip("neither", 3);
    expect(titles(browse({ person: "kobe" }))).toEqual(["with kobe", "by kobe"]);
  });

  it("search narrows and keeps the tab's order", () => {
    clip("apex one", 1);
    clip("valorant", 2);
    clip("apex two", 3);
    expect(titles(browse({ q: "apex" }))).toEqual(["apex two", "apex one"]);
  });

  it("pages with a cursor and ends with null", () => {
    for (let i = 0; i < 30; i++) clip(`c${i}`, i);
    const first = browse({});
    expect(first.clips).toHaveLength(24);
    const second = browse({}, { cursor: first.next! });
    expect(second.clips).toHaveLength(6);
    expect(second.next).toBeNull();
  });

  it("treats another sort's cursor or junk as the first page", () => {
    for (let i = 0; i < 30; i++) clip(`c${i}`, i);
    const topCursor = browse({ sort: "top" }).next!;
    expect(titles(browse({}, { cursor: topCursor }))[0]).toBe("c29");
    expect(titles(browse({}, { cursor: "garbage" }))[0]).toBe("c29");
  });

  it("random pages never repeat or skip for a fixed seed", () => {
    for (let i = 0; i < 30; i++) clip(`c${i}`, i);
    const first = browse({ sort: "random", seed: "9" });
    const second = browse({ sort: "random", seed: "9" }, { cursor: first.next! });
    const seen = [...titles(first), ...titles(second)];
    expect(new Set(seen).size).toBe(30);
    expect(titles(browse({ sort: "random", seed: "10" }))).not.toEqual(titles(first));
  });

  it("trending leaves out clips with no score; top orders by likes then activity then newest", () => {
    const a = clip("a", 1);
    const b = clip("b", 2);
    clip("c", 3);
    const scores: Scores = {
      ...zeroScores,
      trending: (ids) => new Map(ids.map((id) => [id, id === a.id ? 5 : 0])),
      likes: (ids) => new Map(ids.map((id) => [id, id === b.id ? 2 : 0])),
      activity: (ids) => new Map(ids.map((id) => [id, id === a.id ? 9 : 0])),
      likedBy: () => new Set([b.id]),
    };
    expect(titles(browse({ sort: "trending" }, { scores }))).toEqual(["a"]);
    expect(titles(browse({ sort: "top" }, { scores }))).toEqual(["b", "a", "c"]);
    const top = browse({ sort: "top" }, { scores });
    expect(top.clips[0]).toMatchObject({ likeCount: 2, likedByMe: true });
  });

  it("with zero scores, Trending is empty and Top is newest first", () => {
    clip("a", 1);
    clip("b", 2);
    expect(titles(browse({ sort: "trending" }))).toEqual([]);
    expect(titles(browse({ sort: "top" }))).toEqual(["b", "a"]);
  });
});
