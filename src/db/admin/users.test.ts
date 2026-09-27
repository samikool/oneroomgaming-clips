import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { updateProfile } from "@/db/profiles";
import { clips } from "@/db/schema";
import { searchClipIds } from "@/db/search";
import { upsertUser } from "@/db/users";
import { listAdminUsers, resetName } from "./users";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("resetName", () => {
  it("clears the chosen name back to the Authentik fallback, and search forgets the old one", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: "Sam Morgan" }).id;
    const clipId = createClip(db, { title: "x", originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }).id;
    updateProfile(db, "sam", { name: "Zorblax" });
    expect([...searchClipIds(db, "zorblax")!]).toEqual([clipId]);

    const profile = resetName(db, "sam");
    expect(profile.name).toBe("Sam Morgan");
    expect([...searchClipIds(db, "zorblax")!]).toEqual([]);
  });
});

describe("listAdminUsers", () => {
  it("lists every profile with visits, clip count and bytes", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }, new Date(1_000)).id;
    upsertUser(db, { username: "kobe", email: null, displayName: null }, new Date(2_000));
    const a = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1, uploaderId: sam }).id;
    createClip(db, { title: "b", originalFilename: "b.mp4", sizeBytes: 1, uploaderId: sam });
    db.update(clips).set({ sizeBytes: null }).where(eq(clips.id, a)).run();

    const rows = listAdminUsers(db);
    expect(rows.map((r) => [r.profile.username, r.clips, r.bytes, r.lastSeenAt])).toEqual([
      ["kobe", 0, 0, 2_000],
      ["sam", 2, 1, 1_000],
    ]);
    expect(rows[0].previousVisitAt).toBeNull();
  });
});
