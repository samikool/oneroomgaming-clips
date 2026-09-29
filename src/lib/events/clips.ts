import { getClip, hydrateGridClips } from "@/db/clips";
import type { Db } from "@/db/client";
import type { GridClip } from "@/db/clips";
import type { Clip } from "@/db/schema";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { publish } from "@/lib/realtime/publish";

/**
 * One argument on purpose: pages call `rows.map(toSummary)`, which would pass
 * the index as a second one. Callers that know the likes spread them over the
 * result (see `browseClips`).
 */
export function toSummary(clip: Clip | GridClip): ClipSummary {
  const meta = clip as Partial<GridClip>;

  return {
    id: clip.id,
    title: clip.title,
    status: clip.status,
    thumbPath: clip.thumbPath,
    durationMs: clip.durationMs,
    // A Date would arrive as a string on the other side of JSON.
    createdAt: clip.createdAt.getTime(),
    uploader: meta.uploader ?? null,
    game: meta.game ?? null,
    likeCount: 0,
    likedByMe: false,
  };
}

/**
 * Re-reads the clip rather than taking a snapshot argument, so what goes on
 * the wire is always what the database actually holds after the caller's
 * writes — not what the caller believed it wrote.
 */
async function announce(
  db: Db,
  clipId: string,
  t: "clip.added" | "clip.updated",
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  const clip = getClip(db, clipId);

  if (!clip) {
    return;
  }

  // Joined, so the game and uploader on the wire are the real ones — a
  // cleared game arrives as null rather than looking like "not sent".
  await publish({ t, clip: toSummary(hydrateGridClips(db, [clip])[0]) }, env);
}

export function announceClipAdded(
  db: Db,
  clipId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  return announce(db, clipId, "clip.added", env);
}

export function announceClipUpdated(
  db: Db,
  clipId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  return announce(db, clipId, "clip.updated", env);
}

const ANNOUNCE_BATCH = 25;

/**
 * A bulk edit's announcements, 25 at a time. One by one, a realtime that
 * hangs rather than refuses would hold the save open for 2 s per clip — the
 * rows are long committed, but the editor sees "Saving…" for minutes.
 */
export async function announceClipsUpdated(db: Db, ids: string[], env?: Partial<NodeJS.ProcessEnv>): Promise<void> {
  for (let i = 0; i < ids.length; i += ANNOUNCE_BATCH) {
    await Promise.allSettled(ids.slice(i, i + ANNOUNCE_BATCH).map((id) => announceClipUpdated(db, id, env)));
  }
}

/**
 * Announces a deletion.
 *
 * Unlike `announceClipAdded` and `announceClipUpdated` this does not re-read
 * the row — by the time it is called the row is gone, which is the whole
 * point. The id is all the event carries and all any client needs.
 */
export function announceClipRemoved(
  clipId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<boolean> {
  return publish({ t: "clip.removed", clipId }, env);
}
