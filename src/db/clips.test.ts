import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { mediaFiles } from "@/db/schema";
import {
  applyProbe, createClip, getClip, listAllClips, listReadyClips,
  recordMediaFile, setClipStatus, setClipThumb,
} from "@/db/clips";
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
});
