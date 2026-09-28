import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { setClipGame, setClipTags } from "@/db/metadata";
import { listBrowseOptions } from "@/db/browse-options";

let db: Db;
let sam: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
});

const make = (title: string) =>
  createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1, uploaderId: sam });

describe("listBrowseOptions", () => {
  it("gives each game its cover path", () => {
    setClipGame(db, make("a").id, "Apex");
    expect(listBrowseOptions(db).games).toEqual([{ slug: "apex", name: "Apex", coverPath: null }]);
  });

  it("is empty with no clips", () => {
    expect(listBrowseOptions(db)).toEqual({ games: [], tags: [] });
  });

  it("lists games and tags in use, sorted by name, once each", () => {
    const a = make("a");
    const b = make("b");
    setClipGame(db, a.id, "Valorant");
    setClipGame(db, b.id, "Apex Legends");
    setClipTags(db, a.id, ["clutch", "ace"]);
    setClipTags(db, b.id, ["ace"]);

    expect(listBrowseOptions(db)).toEqual({
      games: [
        { slug: "apex-legends", name: "Apex Legends", coverPath: null },
        { slug: "valorant", name: "Valorant", coverPath: null },
      ],
      tags: ["ace", "clutch"],
    });
  });

  it("skips games and tags no clip uses any more", () => {
    const a = make("a");
    setClipGame(db, a.id, "Apex Legends");
    setClipTags(db, a.id, ["ace", "clutch"]);
    setClipGame(db, a.id, "Valorant");
    setClipTags(db, a.id, ["clutch"]);

    expect(listBrowseOptions(db)).toEqual({ games: [{ slug: "valorant", name: "Valorant", coverPath: null }], tags: ["clutch"] });
  });
});
