import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { upsertUser } from "@/db/users";
import {
  getProfile,
  listProfiles,
  ProfileValidationError,
  setPictureVersion,
  updateProfile,
} from "@/db/profiles";
import { defaultAccent } from "@/lib/profiles/palette";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  upsertUser(db, { username: "sam", email: null, displayName: "Sam Morgan" });
  upsertUser(db, { username: "kobe", email: null, displayName: null });
});

describe("effective profile of an untouched user", () => {
  it("falls back to the Authentik name, then the username", () => {
    expect(getProfile(db, "sam")?.name).toBe("Sam Morgan");
    expect(getProfile(db, "kobe")?.name).toBe("kobe");
  });

  it("uses the hashed default accent and has no picture or bio", () => {
    const kobe = getProfile(db, "kobe")!;
    expect(kobe.accent).toBe(defaultAccent("kobe"));
    expect(kobe.pictureVersion).toBeNull();
    expect(kobe.bio).toBeNull();
  });

  it("returns undefined for someone never seen", () => {
    expect(getProfile(db, "ghost")).toBeUndefined();
  });

  it("lists everyone, by username", () => {
    expect(listProfiles(db).map((p) => p.username)).toEqual(["kobe", "sam"]);
  });
});

describe("updateProfile", () => {
  it("sets a chosen name that wins over Authentik's", () => {
    expect(updateProfile(db, "sam", { name: "  Samwise  " }).name).toBe("Samwise");
    // Authentik re-sending its name must not undo the choice.
    upsertUser(db, { username: "sam", email: null, displayName: "Sam Morgan" });
    expect(getProfile(db, "sam")?.name).toBe("Samwise");
  });

  it("clears the chosen name on an empty submission", () => {
    updateProfile(db, "sam", { name: "Samwise" });
    expect(updateProfile(db, "sam", { name: "   " }).name).toBe("Sam Morgan");
  });

  it("counts characters, not code units, so 32 emoji fit", () => {
    const name = "🔥".repeat(32);
    expect(updateProfile(db, "sam", { name }).name).toBe(name);
    expect(() => updateProfile(db, "sam", { name: "🔥".repeat(33) })).toThrow(ProfileValidationError);
  });

  it("rejects control characters in names", () => {
    expect(() => updateProfile(db, "sam", { name: "a\u0007b" })).toThrow(ProfileValidationError);
  });

  it("accepts palette accents only", () => {
    expect(updateProfile(db, "sam", { accent: "pink" }).accent).toBe("pink");
    try {
      updateProfile(db, "sam", { accent: "chartreuse" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ProfileValidationError).fields.accent).toBeDefined();
    }
  });

  it("keeps newlines in a bio but caps it at 160", () => {
    expect(updateProfile(db, "sam", { bio: "line one\nline two" }).bio).toBe("line one\nline two");
    expect(() => updateProfile(db, "sam", { bio: "x".repeat(161) })).toThrow(ProfileValidationError);
    expect(updateProfile(db, "sam", { bio: "  " }).bio).toBeNull();
  });

  it("touches only the fields given", () => {
    updateProfile(db, "sam", { name: "Samwise", accent: "lime", bio: "hi" });
    const after = updateProfile(db, "sam", { bio: "bye" });
    expect(after).toMatchObject({ name: "Samwise", accent: "lime", bio: "bye" });
  });

  it("saves nothing when any field is invalid", () => {
    expect(() => updateProfile(db, "sam", { name: "Fine", bio: "x".repeat(200) })).toThrow();
    expect(getProfile(db, "sam")?.name).toBe("Sam Morgan");
  });
});

describe("setPictureVersion", () => {
  it("sets and clears the version", () => {
    expect(setPictureVersion(db, "sam", 3).pictureVersion).toBe(3);
    expect(setPictureVersion(db, "sam", null).pictureVersion).toBeNull();
  });
});

describe("migration 0004", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migrations-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("applies on top of 0003, and rows written before it read with fallbacks", () => {
    // A copy of the migrations folder whose journal stops at 0003: the
    // database as it stood before profiles existed.
    cpSync("./drizzle", dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((entry) => entry.tag < "0004");
    writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(":memory:");
    const old = drizzle(sqlite, { schema });
    migrate(old, { migrationsFolder: dir });
    sqlite.exec(
      "INSERT INTO users (id, authentik_username, email, display_name, avatar_url, created_at, last_seen_at) " +
        "VALUES ('U1', 'puddy', NULL, 'Lil Puddy', NULL, 0, 0), ('U2', 'kobe', NULL, NULL, NULL, 0, 0)",
    );

    writeFileSync(journalPath, JSON.stringify(full));
    migrate(old, { migrationsFolder: dir });

    expect(getProfile(old, "puddy")).toEqual({
      username: "puddy",
      userId: "U1",
      name: "Lil Puddy",
      accent: defaultAccent("puddy"),
      bio: null,
      pictureVersion: null,
    });
    expect(getProfile(old, "kobe")?.name).toBe("kobe");
  });
});
