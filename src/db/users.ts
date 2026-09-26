import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { users, type User } from "./schema";
import type { AuthenticatedUser } from "@/lib/auth";

/** Upserts the request's identity, saying whether this is the first sight of them. */
export function upsertUserTracked(
  db: Db,
  identity: AuthenticatedUser,
  now: Date = new Date(),
): { user: User; created: boolean } {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.authentikUsername, identity.username))
    .get();

  if (existing) {
    const user = db
      .update(users)
      .set({
        email: identity.email ?? existing.email,
        displayName: identity.displayName ?? existing.displayName,
        lastSeenAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();

    return { user, created: false };
  }

  const user = db
    .insert(users)
    .values({
      id: ulid(),
      authentikUsername: identity.username,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: null,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get();

  return { user, created: true };
}

export function upsertUser(db: Db, identity: AuthenticatedUser, now: Date = new Date()): User {
  return upsertUserTracked(db, identity, now).user;
}

/** Every username known here, for the participant picker's hint. */
export function listUsernames(db: Db): string[] {
  return db
    .select({ name: users.authentikUsername })
    .from(users)
    .orderBy(asc(users.authentikUsername))
    .all()
    .map((row) => row.name);
}
