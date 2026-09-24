import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { mediaFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { clips } from "@/db/schema";
import {
  applyProbe, createClip, deleteClip, getClip, listAllClips, listClips, listReadyClips,
  recordMediaFile, setClipStatus, setClipThumb, totalDiskBytes,
} from "@/db/clips";
import { setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";
import { upsertUser } from "@/db/users";
import type { MediaInfo } from "@/lib/media/probe";

const info: MediaInfo = {
  durationMs: 1500, width: 1920, height: 1080, videoCodec: "h264",
  audioCodec: "aac", bitrate: 5_000_000, container: "mov,mp4", sizeBytes: 4242,
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("clip queries", () => {
  it("creates a pending clip", () => {
    const clip = createClip(db, { title: "ace", originalFilename: "ace.mp4", sizeBytes: 10 });
    expect(clip.status).toBe("pending");
    expect(clip.title).toBe("ace");
  });

  it("writes probe results onto the clip", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    const updated = applyProbe(db, clip.id, info);

    expect(updated.width).toBe(1920);
    expect(updated.videoCodec).toBe("h264");
    expect(updated.durationMs).toBe(1500);
  });

  it("leaves fields it does not own untouched", () => {
    const clip = createClip(db, { title: "ace", originalFilename: "a.mp4", sizeBytes: 10 });
    setClipThumb(db, clip.id, "/media/thumbs/x.jpg");

    const updated = applyProbe(db, clip.id, info);

    // applyProbe widening its .set() payload is a plausible future regression,
    // and nothing else in the suite would notice.
    expect(updated.title).toBe("ace");
    expect(updated.status).toBe("pending");
    expect(updated.thumbPath).toBe("/media/thumbs/x.jpg");
    expect(updated.createdAt.getTime()).toBe(clip.createdAt.getTime());
  });

  it("sets status and clears the error when succeeding", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    setClipStatus(db, clip.id, "failed", "boom");
    const recovered = setClipStatus(db, clip.id, "ready");

    expect(recovered.status).toBe("ready");
    expect(recovered.errorMessage).toBeNull();
  });

  it("records a media file row", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    recordMediaFile(db, clip.id, {
      kind: "original", path: "/media/clips/x.mp4", info, isDefault: true,
    });

    const row = db.select().from(mediaFiles).get();
    expect(row?.kind).toBe("original");
    expect(row?.isDefault).toBe(true);
  });

  it("lists only ready clips, newest first", () => {
    const a = createClip(db, { title: "old", originalFilename: "a.mp4", sizeBytes: 1 }, new Date("2026-01-01"));
    const b = createClip(db, { title: "new", originalFilename: "b.mp4", sizeBytes: 1 }, new Date("2026-01-02"));
    createClip(db, { title: "pending", originalFilename: "c.mp4", sizeBytes: 1 });

    setClipStatus(db, a.id, "ready");
    setClipStatus(db, b.id, "ready");

    expect(listReadyClips(db).map((c) => c.title)).toEqual(["new", "old"]);
  });

  it("lists all clips regardless of status", () => {
    createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    createClip(db, { title: "b", originalFilename: "b.mp4", sizeBytes: 1 });

    expect(listAllClips(db)).toHaveLength(2);
  });

  it("stores a thumbnail path", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    expect(setClipThumb(db, clip.id, "/media/thumbs/x.jpg").thumbPath).toBe("/media/thumbs/x.jpg");
  });

  it("returns undefined for a clip that does not exist", () => {
    expect(getClip(db, "nope")).toBeUndefined();
  });

  it("removes a clip", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    deleteClip(db, clip.id);

    expect(listAllClips(db)).toHaveLength(0);
  });
});

function seed(id: string, uploaderId?: string) {
  return createClip(db, {
    id, title: id, originalFilename: `${id}.mp4`, sizeBytes: 100, uploaderId,
  });
}

describe("listClips", () => {
  it("returns everything, newest first, when unfiltered", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    seed("01A", sam);
    seed("01B", sam);

    expect(listClips(db).map((c) => c.id)).toEqual(["01B", "01A"]);
  });

  it("filters by tag", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    seed("01A", sam);
    seed("01B", sam);
    setClipTags(db, "01A", ["ace"]);

    expect(listClips(db, { tag: "ace" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("filters by game slug", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    seed("01A", sam);
    seed("01B", sam);
    setClipGame(db, "01A", "Valorant");

    expect(listClips(db, { game: "valorant" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("filters by uploader username", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
    seed("01A", sam);
    seed("01B", dave);

    expect(listClips(db, { uploader: "dave" }).map((c) => c.id)).toEqual(["01B"]);
  });

  it("filters by participant", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    upsertUser(db, { username: "dave", email: null, displayName: null });
    seed("01A", sam);
    seed("01B", sam);
    setClipParticipants(db, "01A", ["dave"]);

    expect(listClips(db, { participant: "dave" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("ANDs filters together rather than ORing them", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
    seed("01A", sam);
    seed("01B", dave);
    setClipTags(db, "01A", ["ace"]);
    setClipTags(db, "01B", ["ace"]);

    expect(listClips(db, { tag: "ace", uploader: "dave" }).map((c) => c.id)).toEqual(["01B"]);
  });

  it("returns nothing for a filter that matches nothing", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    seed("01A", sam);

    expect(listClips(db, { tag: "nonexistent" })).toEqual([]);
  });

  it("does not return a clip twice when it has several tags", () => {
    // A join against clip_tags multiplies rows. Without a subquery the grid
    // renders the same card once per tag.
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    seed("01A", sam);
    setClipTags(db, "01A", ["ace", "clutch", "funny"]);

    expect(listClips(db, { tag: "ace" })).toHaveLength(1);
  });
});

describe("totalDiskBytes", () => {
  it("is zero with no clips", () => {
    expect(totalDiskBytes(db)).toBe(0);
  });

  it("sums what the pipeline recorded", () => {
    seed("01A");
    seed("01B");
    db.update(clips).set({ sizeBytes: 1_000 }).where(eq(clips.id, "01A")).run();
    db.update(clips).set({ sizeBytes: 2_500 }).where(eq(clips.id, "01B")).run();

    expect(totalDiskBytes(db)).toBe(3_500);
  });

  it("ignores clips whose size is not known yet", () => {
    seed("01A");
    db.update(clips).set({ sizeBytes: 1_000 }).where(eq(clips.id, "01A")).run();
    seed("01B");
    db.update(clips).set({ sizeBytes: null }).where(eq(clips.id, "01B")).run();

    expect(totalDiskBytes(db)).toBe(1_000);
  });
});
