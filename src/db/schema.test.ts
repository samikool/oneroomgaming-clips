import { describe, expect, it } from "bun:test";
import { createDb } from "@/db/client";
import { clips, games, jobs } from "@/db/schema";
import { ulid } from "ulid";

describe("schema", () => {
  it("creates a clip and reads it back", () => {
    const db = createDb(":memory:");
    const now = new Date();
    const id = ulid();

    db.insert(clips).values({
      id,
      title: "ace round",
      originalFilename: "ace.mp4",
      uploaderId: null,
      gameId: null,
      status: "pending",
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      sizeBytes: 1234,
      recordedAt: null,
      thumbPath: null,
      errorMessage: null,
      createdAt: now,
    }).run();

    const row = db.select().from(clips).get();
    expect(row?.title).toBe("ace round");
    expect(row?.status).toBe("pending");
    expect(row?.createdAt.getTime()).toBe(now.getTime());
  });

  it("enqueues a job referencing a clip", () => {
    const db = createDb(":memory:");
    const clipId = ulid();
    const now = new Date();

    db.insert(clips).values({
      id: clipId, title: "t", originalFilename: "t.mp4", uploaderId: null,
      gameId: null, status: "pending", durationMs: null, width: null,
      height: null, videoCodec: null, audioCodec: null, sizeBytes: 1,
      recordedAt: null, thumbPath: null, errorMessage: null, createdAt: now,
    }).run();

    db.insert(jobs).values({
      id: ulid(), clipId, type: "probe", status: "queued", attempts: 0,
      lastError: null, createdAt: now, startedAt: null, finishedAt: null,
    }).run();

    expect(db.select().from(jobs).get()?.type).toBe("probe");
  });

  it("enforces the unique constraint on game slug", () => {
    const db = createDb(":memory:");
    db.insert(games).values({ id: ulid(), name: "Valorant", slug: "valorant" }).run();

    expect(() =>
      db.insert(games).values({ id: ulid(), name: "Valorant 2", slug: "valorant" }).run(),
    ).toThrow();
  });
});
