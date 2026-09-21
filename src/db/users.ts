import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { users, type User } from "./schema";
import type { AuthenticatedUser } from "@/lib/auth";

export function upsertUser(
  db: Db,
  identity: AuthenticatedUser,
  now: Date = new Date(),
): User {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.authentikUsername, identity.username))
    .get();

  if (existing) {
    return db
      .update(users)
      .set({
        email: identity.email ?? existing.email,
        displayName: identity.displayName ?? existing.displayName,
        lastSeenAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();
  }

  return db
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
}
