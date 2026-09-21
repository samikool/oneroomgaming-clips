import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("upsertUser", () => {
  it("creates a user on first sight", () => {
    const user = upsertUser(db, {
      username: "sam",
      email: "sam@example.com",
      displayName: "Sam Morgan",
    });

    expect(user.authentikUsername).toBe("sam");
    expect(user.email).toBe("sam@example.com");
    expect(user.displayName).toBe("Sam Morgan");
    expect(user.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("returns the same row on a second sight rather than creating a duplicate", () => {
    const first = upsertUser(db, { username: "sam", email: null, displayName: null });
    const second = upsertUser(db, { username: "sam", email: null, displayName: null });

    expect(second.id).toBe(first.id);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it("advances lastSeenAt on a repeat sight", () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-02T00:00:00Z");

    upsertUser(db, { username: "sam", email: null, displayName: null }, earlier);
    const seen = upsertUser(db, { username: "sam", email: null, displayName: null }, later);

    expect(seen.lastSeenAt.getTime()).toBe(later.getTime());
    expect(seen.createdAt.getTime()).toBe(earlier.getTime());
  });

  it("updates email and display name when Authentik supplies new values", () => {
    upsertUser(db, { username: "sam", email: "old@example.com", displayName: "Old" });
    const updated = upsertUser(db, {
      username: "sam",
      email: "new@example.com",
      displayName: "New",
    });

    expect(updated.email).toBe("new@example.com");
    expect(updated.displayName).toBe("New");
  });

  it("keeps existing email and display name when Authentik omits them", () => {
    upsertUser(db, { username: "sam", email: "sam@example.com", displayName: "Sam" });
    const updated = upsertUser(db, { username: "sam", email: null, displayName: null });

    expect(updated.email).toBe("sam@example.com");
    expect(updated.displayName).toBe("Sam");
  });

  it("keeps distinct users separate", () => {
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null });
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null });

    expect(sam.id).not.toBe(dave.id);
  });
});
