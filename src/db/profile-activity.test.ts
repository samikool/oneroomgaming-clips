import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { addComment, softDeleteComment } from "@/db/comments";
import { setClipParticipants } from "@/db/metadata";
import { listAppearancesOf, listCommentsBy, listUploadsBy } from "@/db/profile-activity";

let db: Db;
let sam: string;
let kobe: string;

beforeEach(() => {
  db = createDb(":memory:");
  sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
});

function clip(title: string, uploaderId: string, at: number) {
  return createClip(db, { title, originalFilename: `${title}.mp4`, sizeBytes: 1, uploaderId }, new Date(at));
}

describe("profile activity", () => {
  it("lists a person's uploads, newest first, with the uploader filled in", () => {
    clip("old", sam, 1);
    clip("new", sam, 2);
    clip("theirs", kobe, 3);
    const uploads = listUploadsBy(db, sam);
    expect(uploads.map((c) => c.title)).toEqual(["new", "old"]);
    expect(uploads[0].uploader).toBe("sam");
  });

  it("lists clips a person appears in", () => {
    const c = clip("dunk", kobe, 1);
    clip("other", kobe, 2);
    setClipParticipants(db, c.id, ["sam"]);
    expect(listAppearancesOf(db, sam).map((x) => x.title)).toEqual(["dunk"]);
  });

  it("lists a person's live comments with the clip title", () => {
    const c = clip("dunk", kobe, 1);
    addComment(db, { clipId: c.id, userId: sam, body: "nice" });
    addComment(db, { clipId: c.id, userId: kobe, body: "not sam" });
    const gone = addComment(db, { clipId: c.id, userId: sam, body: "oops" });
    softDeleteComment(db, gone.id, sam);
    expect(listCommentsBy(db, sam)).toMatchObject([{ clipId: c.id, clipTitle: "dunk", body: "nice" }]);
  });

  it("lists comments newest first", () => {
    const c = clip("dunk", kobe, 1);
    addComment(db, { clipId: c.id, userId: sam, body: "first" });
    addComment(db, { clipId: c.id, userId: sam, body: "second" });
    expect(listCommentsBy(db, sam).map((x) => x.body)).toEqual(["second", "first"]);
  });
});
