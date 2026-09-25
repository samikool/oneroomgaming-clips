import { cache } from "react";
import { headers } from "next/headers";
import { assertAdmin, resolveIdentity } from "@/lib/auth";
import { getDb } from "@/db/client";
import { upsertUser } from "@/db/users";
import type { User } from "@/db/schema";

// resolveIdentity lives in @/lib/auth: the realtime process needs it too,
// and this module imports next/headers and the database.
export { resolveIdentity };

export const requireUser = cache(async function requireUser(): Promise<User> {
  const identity = resolveIdentity(await headers());
  return upsertUser(getDb(), identity);
});

/**
 * `requireUser`, but refuses anyone who is not in `CLIPS_ADMINS`.
 *
 * The decision itself lives in `assertAdmin` so it can be tested without a
 * request context. This is only the part that needs one.
 *
 * Every destructive server action calls this itself. A server action is a
 * public HTTP endpoint with a generated name — the page having hidden the
 * button says nothing about who is calling it.
 */
export const requireAdmin = cache(async function requireAdmin(): Promise<User> {
  const user = await requireUser();

  assertAdmin({
    username: user.authentikUsername,
    email: user.email,
    displayName: user.displayName,
  });

  return user;
});
