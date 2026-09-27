import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { createClip, totalDiskBytes } from "@/db/clips";
import { clips } from "@/db/schema";
import { upsertUser } from "@/db/users";
import { avatarsBytes, storageByUploader } from "./storage";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

function clip(uploaderId: string | null, sizeBytes: number | null) {
  const { id } = createClip(db, { title: "c", originalFilename: "c.mp4", sizeBytes: 0, uploaderId });
  db.update(clips).set({ sizeBytes }).where(eq(clips.id, id)).run();
}

describe("storageByUploader", () => {
  it("sums per uploader, biggest first, with null sizes as 0 and uploader-less clips grouped as null", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    const kobe = upsertUser(db, { username: "kobe", email: null, displayName: null }).id;
    clip(sam, 100);
    clip(sam, null);
    clip(kobe, 300);
    clip(null, 100);

    const rows = storageByUploader(db);
    expect(rows.map((r) => [r.username, r.clips, r.bytes])).toEqual([
      ["kobe", 1, 300],
      ["sam", 2, 100],
      [null, 1, 100],
    ]);
    expect(rows.map((r) => r.share)).toEqual([0.6, 0.2, 0.2]);
    expect(rows.reduce((sum, r) => sum + r.bytes, 0)).toBe(totalDiskBytes(db));
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("gives every share as 0 when nothing has a size", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    clip(sam, null);
    expect(storageByUploader(db)).toEqual([{ username: "sam", clips: 1, bytes: 0, share: 0 }]);
  });

  it("is empty for an empty library", () => {
    expect(storageByUploader(db)).toEqual([]);
  });
});

describe("avatarsBytes", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "avatars-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("sums the files under MEDIA_ROOT/avatars, and is 0 when there are none", () => {
    expect(avatarsBytes({ MEDIA_ROOT: root })).toBe(0);
    mkdirSync(join(root, "avatars"), { recursive: true });
    writeFileSync(join(root, "avatars", "a-1-64.webp"), "12345");
    writeFileSync(join(root, "avatars", "a-1-256.webp"), "1234567890");
    expect(avatarsBytes({ MEDIA_ROOT: root })).toBe(15);
  });
});
