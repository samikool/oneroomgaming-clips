import type { Db } from "@/db/client";
import { deleteClipCascade, getClip } from "@/db/clips";
import { announceClipRemoved } from "@/lib/events/clips";
import { removeClipFiles } from "@/lib/media/cleanup";

/**
 * Deletes clips permanently: rows, then files, then the live announcement.
 *
 * Returns the ids actually removed, which is not necessarily what was asked
 * for — an id already gone is skipped rather than treated as an error. Two
 * admins deleting the same clip, or one double-submitting, must not fail.
 *
 * **Database first, files second.** The reverse order leaves a surviving row
 * pointing at a video that no longer exists, which renders as a broken card in
 * everyone's grid. A failed unlink after the commit only orphans bytes, which
 * is invisible and reclaimable.
 *
 * Announcing is last and cannot fail the deletion: `publish` swallows its own
 * errors, so realtime being down costs a live update, not the delete. That is
 * the same property the ingest pipeline already has.
 *
 * Authorization is NOT here. It belongs at the action boundary, because
 * admin-ness is a property of the user rather than of any row this touches.
 */
export async function removeClips(
  db: Db,
  env: Partial<NodeJS.ProcessEnv>,
  ids: string[],
): Promise<string[]> {
  const removed: string[] = [];

  for (const id of ids) {
    if (!getClip(db, id)) {
      continue;
    }

    deleteClipCascade(db, id);
    removeClipFiles(env, id);
    removed.push(id);
  }

  for (const id of removed) {
    await announceClipRemoved(id, env);
  }

  return removed;
}
