import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, deleteClipCascade } from "@/db/clips";
import { addComment, softDeleteComment } from "@/db/comments";
import { setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";
import { reindexAll, searchClipIds } from "@/db/search";
import { sql } from "drizzle-orm";

let db: Db;
let sam: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: "Sam Morgan" }).id;
  upsertUser(db, { username: "kobe", email: null, displayName: "Kobe" });
});

const make = (title: string) =>
  createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1, uploaderId: sam });
const ids = (q: string) => [...(searchClipIds(db, q) ?? [])];

describe("search index", () => {
  it("finds a clip by title prefix as soon as it is created", () => {
    const c = make("insane clutch");
    expect(ids("clu")).toEqual([c.id]);
  });

  it("finds by game, tag and people (username and Authentik name)", () => {
    const c = make("round one");
    setClipGame(db, c.id, "Apex Legends");
    setClipTags(db, c.id, ["ace"]);
    setClipParticipants(db, c.id, ["kobe"]);
    expect(ids("apex")).toEqual([c.id]);
    expect(ids("ace")).toEqual([c.id]);
    expect(ids("kobe")).toEqual([c.id]);
    expect(ids("morgan")).toEqual([c.id]); // the uploader's display name
  });

  it("finds by comment text and forgets deleted comments", () => {
    const c = make("round two");
    const comment = addComment(db, { clipId: c.id, userId: sam, body: "kobe yelled so loud" });
    expect(ids("yelled")).toEqual([c.id]);
    softDeleteComment(db, comment.id, sam);
    expect(ids("yelled")).toEqual([]);
  });

  it("requires every word", () => {
    const a = make("apex clutch");
    make("apex fail");
    expect(ids("apex clu")).toEqual([a.id]);
  });

  it("drops a deleted clip from the index", () => {
    const c = make("gone soon");
    deleteClipCascade(db, c.id);
    expect(ids("gone")).toEqual([]);
  });

  it("is null for a blank search", () => {
    expect(searchClipIds(db, "  ")).toBeNull();
  });

  it("rebuilds everything from scratch", () => {
    const c = make("rebuilt");
    db.run(sql`DELETE FROM clip_search`);
    expect(ids("rebuilt")).toEqual([]);
    expect(reindexAll(db)).toBe(1);
    expect(ids("rebuilt")).toEqual([c.id]);
  });
});
