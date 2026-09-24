import { getClip } from "@/db/clips";
import type { Db } from "@/db/client";
import type { GridClip } from "@/db/clips";
import type { Clip } from "@/db/schema";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { publish } from "@/lib/realtime/publish";

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

  await publish({ t, clip: toSummary(clip) }, env);
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
