"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { removeClips } from "@/lib/clips/remove";
import { requireAdmin } from "@/lib/session";

/** Selecting more than this in one go is a mistake, not an intention. */
const MAX_PER_CALL = 200;

/**
 * Permanently deletes clips. Admins only.
 *
 * `requireAdmin` is the authorization boundary and runs before anything is
 * read or written. It is not a second check behind a hidden button — hiding
 * the button is presentation, and this endpoint is reachable without it.
 *
 * The argument is whatever the client sent, so it is narrowed here rather than
 * trusted: a server action's parameters are as untrusted as a request body.
 *
 * Returns the number actually deleted, which can be lower than what was asked
 * for when someone else got there first.
 */
export async function deleteClips(ids: unknown): Promise<number> {
  await requireAdmin();

  if (!Array.isArray(ids)) {
    return 0;
  }

  const clean = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ].slice(0, MAX_PER_CALL);

  if (clean.length === 0) {
    return 0;
  }

  const removed = await removeClips(getDb(), process.env, clean);

  if (removed.length > 0) {
    revalidatePath("/");
  }

  return removed.length;
}
