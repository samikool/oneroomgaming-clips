"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { removeClips } from "@/lib/clips/remove";
import { getClip } from "@/db/clips";
import { requireAdmin, requireUser } from "@/lib/session";

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

/** Far more than one tab ever has processing at once. */
const MAX_STATUS_IDS = 50;

/**
 * Current status of each clip, keyed by id. The upload tray calls this after
 * a reconnect, for clips whose "ready" push may have landed while the socket
 * was down. Unknown ids are simply absent. Signed-in users only; the input is
 * as untrusted as any request body.
 */
export async function clipStatuses(ids: unknown): Promise<Record<string, string>> {
  await requireUser();

  if (!Array.isArray(ids)) {
    return {};
  }

  const db = getDb();
  const statuses: Record<string, string> = {};

  for (const id of new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))) {
    if (Object.keys(statuses).length >= MAX_STATUS_IDS) {
      break;
    }

    const clip = getClip(db, id);

    if (clip) {
      statuses[id] = clip.status;
    }
  }

  return statuses;
}
