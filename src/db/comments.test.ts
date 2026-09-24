import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { addComment, getComment, listComments, softDeleteComment } from "@/db/comments";
import { upsertUser } from "@/db/users";

let db: Db;
let samId: string;
let daveId: string;
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
  daveId = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
  clipId = seedClip("01TESTCLIP");
});

describe("addComment", () => {
  it("returns the comment with the author's username, not their ULID", () => {
    // The wire identity is the Authentik username. A ULID on the page would
    // be both meaningless and a leak of an internal key.
    const comment = addComment(db, { clipId, userId: samId, body: "gg" });

    expect(comment).toMatchObject({ clipId, user: "sam", body: "gg", deleted: false });
    expect(typeof comment.at).toBe("number");
  });

  it("gives each comment a distinct id", () => {
    const first = addComment(db, { clipId, userId: samId, body: "a" });
    const second = addComment(db, { clipId, userId: samId, body: "b" });

    expect(first.id).not.toBe(second.id);
  });
});

describe("listComments", () => {
  it("is empty for a clip nobody has commented on", () => {
    expect(listComments(db, clipId)).toEqual([]);
  });

  it("returns oldest first, so a thread reads top to bottom", () => {
    addComment(db, { clipId, userId: samId, body: "first" });
    addComment(db, { clipId, userId: daveId, body: "second" });

    expect(listComments(db, clipId).map((c) => c.body)).toEqual(["first", "second"]);
  });

  it("does not return another clip's comments", () => {
    const other = seedClip("01OTHERCLIP");
    addComment(db, { clipId: other, userId: samId, body: "elsewhere" });

    expect(listComments(db, clipId)).toEqual([]);
  });

  it("keeps a deleted comment in the list, flagged", () => {
    // A thread with holes in it is incoherent. The tombstone stays.
    const comment = addComment(db, { clipId, userId: samId, body: "oops" });
    softDeleteComment(db, comment.id, samId);

    const listed = listComments(db, clipId);
    expect(listed).toHaveLength(1);
    expect(listed[0].deleted).toBe(true);
  });

  it("does not leak the body of a deleted comment", () => {
    // Sending the text with a flag and hiding it in CSS is not deletion.
    const comment = addComment(db, { clipId, userId: samId, body: "regrettable" });
    softDeleteComment(db, comment.id, samId);

    expect(listComments(db, clipId)[0].body).not.toContain("regrettable");
  });
});

describe("softDeleteComment", () => {
  it("lets the author delete their own comment", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });

    expect(softDeleteComment(db, comment.id, samId)).toBe(true);
    expect(getComment(db, comment.id)?.deleted).toBe(true);
  });

  it("refuses to let someone delete another person's comment", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });

    expect(softDeleteComment(db, comment.id, daveId)).toBe(false);
    expect(getComment(db, comment.id)?.deleted).toBe(false);
  });

  it("returns false for a comment that does not exist", () => {
    expect(softDeleteComment(db, "01NOPE", samId)).toBe(false);
  });

  it("is idempotent", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });
    softDeleteComment(db, comment.id, samId);

    expect(softDeleteComment(db, comment.id, samId)).toBe(true);
  });
});
