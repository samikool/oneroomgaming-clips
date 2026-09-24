import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import {
  getClipMetadata,
  listGames,
  listTags,
  setClipGame,
  setClipParticipants,
  setClipTags,
  slugify,
} from "@/db/metadata";
import { upsertUser } from "@/db/users";

let db: Db;
let samId: string;
let clipId: string;

function seedClip(id: string): string {
  return createClip(db, {
    id,
    title: "ace",
    originalFilename: "ace.mp4",
    sizeBytes: 1000,
    uploaderId: samId,
  }).id;
}

beforeEach(() => {
  db = createDb(":memory:");
  samId = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  upsertUser(db, { username: "dave", email: null, displayName: null });
  clipId = seedClip("01TESTCLIP");
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Counter Strike 2")).toBe("counter-strike-2");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(slugify("  Tom's Game!!  ")).toBe("tom-s-game");
  });
});

describe("getClipMetadata", () => {
  it("is empty for a fresh clip", () => {
    expect(getClipMetadata(db, clipId)).toEqual({ tags: [], game: null, participants: [] });
  });
});

describe("setClipTags", () => {
  it("attaches tags and reads them back sorted", () => {
    setClipTags(db, clipId, ["clutch", "ace"]);
    expect(getClipMetadata(db, clipId).tags).toEqual(["ace", "clutch"]);
  });

  it("reuses an existing tag row rather than duplicating it", () => {
    const other = seedClip("01OTHER");
    setClipTags(db, clipId, ["ace"]);
    setClipTags(db, other, ["ace"]);

    expect(listTags(db)).toEqual(["ace"]);
  });

  it("replaces the whole set rather than adding to it", () => {
    setClipTags(db, clipId, ["ace", "clutch"]);
    setClipTags(db, clipId, ["fail"]);

    expect(getClipMetadata(db, clipId).tags).toEqual(["fail"]);
  });

  it("normalises case and whitespace so 'Ace' and 'ace' are one tag", () => {
    setClipTags(db, clipId, ["  Ace  ", "ace", "ACE"]);

    expect(getClipMetadata(db, clipId).tags).toEqual(["ace"]);
    expect(listTags(db)).toEqual(["ace"]);
  });

  it("drops empty entries", () => {
    setClipTags(db, clipId, ["ace", "", "   "]);
    expect(getClipMetadata(db, clipId).tags).toEqual(["ace"]);
  });

  it("clears every tag when given an empty list", () => {
    setClipTags(db, clipId, ["ace"]);
    setClipTags(db, clipId, []);

    expect(getClipMetadata(db, clipId).tags).toEqual([]);
  });
});

describe("setClipGame", () => {
  it("creates the game and attaches it", () => {
    setClipGame(db, clipId, "Valorant");

    expect(getClipMetadata(db, clipId).game).toMatchObject({ name: "Valorant", slug: "valorant" });
  });

  it("reuses an existing game by slug, keeping the original name", () => {
    setClipGame(db, clipId, "Valorant");
    const other = seedClip("01OTHER");
    setClipGame(db, other, "valorant");

    expect(listGames(db)).toHaveLength(1);
    expect(getClipMetadata(db, other).game?.name).toBe("Valorant");
  });

  it("clears the game when given null", () => {
    setClipGame(db, clipId, "Valorant");
    setClipGame(db, clipId, null);

    expect(getClipMetadata(db, clipId).game).toBeNull();
  });
});

describe("setClipParticipants", () => {
  it("attaches known users and reads them back sorted", () => {
    setClipParticipants(db, clipId, ["dave", "sam"]);
    expect(getClipMetadata(db, clipId).participants).toEqual(["dave", "sam"]);
  });

  it("silently ignores a username that is not a user here", () => {
    // Users only exist after their first login. Inventing a row for a
    // mistyped name would put a ghost in the participant filter forever.
    setClipParticipants(db, clipId, ["sam", "nobody"]);

    expect(getClipMetadata(db, clipId).participants).toEqual(["sam"]);
  });

  it("replaces the whole set", () => {
    setClipParticipants(db, clipId, ["sam", "dave"]);
    setClipParticipants(db, clipId, ["dave"]);

    expect(getClipMetadata(db, clipId).participants).toEqual(["dave"]);
  });
});
