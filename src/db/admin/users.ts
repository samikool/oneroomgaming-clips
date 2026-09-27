import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { toProfile, updateProfile, type Profile } from "@/db/profiles";
import { clips, users } from "@/db/schema";

export type AdminUser = {
  profile: Profile;
  /** Epoch milliseconds. */
  lastSeenAt: number;
  previousVisitAt: number | null;
  /** Whether they picked a name of their own, which is what Reset name clears. */
  hasChosenName: boolean;
  clips: number;
  bytes: number;
};

/** Everyone who has ever signed in, by username, with what they've uploaded. */
export function listAdminUsers(db: Db): AdminUser[] {
  return db
    .select({
      user: users,
      clips: count(clips.id),
      bytes: sql<number>`coalesce(sum(${clips.sizeBytes}), 0)`,
    })
    .from(users)
    .leftJoin(clips, eq(clips.uploaderId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.authentikUsername))
    .all()
    .map(({ user, clips: clipCount, bytes }) => ({
      profile: toProfile(user),
      lastSeenAt: user.lastSeenAt.getTime(),
      previousVisitAt: user.previousVisitAt?.getTime() ?? null,
      hasChosenName: user.profileName !== null,
      clips: clipCount,
      bytes,
    }));
}

/**
 * Clears a chosen name back to the Authentik name (or the username). Goes
 * through `updateProfile`, so the search reindex of their clips comes along.
 */
export function resetName(db: Db, username: string): Profile {
  return updateProfile(db, username, { name: "" });
}
