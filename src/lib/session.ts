import { cache } from "react";
import { headers } from "next/headers";
import {
  MissingAuthHeadersError,
  parseAuthentikHeaders,
  type AuthenticatedUser,
} from "@/lib/auth";
import { getDb } from "@/db/client";
import { upsertUser } from "@/db/users";
import type { User } from "@/db/schema";

export function resolveIdentity(
  requestHeaders: Headers,
  env: NodeJS.ProcessEnv = process.env,
): AuthenticatedUser {
  try {
    return parseAuthentikHeaders(requestHeaders);
  } catch (error) {
    if (!(error instanceof MissingAuthHeadersError)) {
      throw error;
    }

    const fallback = env.DEV_AUTH_USERNAME?.trim();

    if (env.NODE_ENV !== "production" && fallback) {
      return { username: fallback, email: null, displayName: fallback };
    }

    throw error;
  }
}

export const requireUser = cache(async function requireUser(): Promise<User> {
  const identity = resolveIdentity(await headers());
  return upsertUser(getDb(), identity);
});
