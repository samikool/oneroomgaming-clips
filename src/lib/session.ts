import { cache } from "react";
import { headers } from "next/headers";
import { resolveIdentity } from "@/lib/auth";
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
