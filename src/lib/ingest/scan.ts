import { existsSync, readdirSync, renameSync, lstatSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import type { JobContext } from "@/lib/jobs/types";
import { clipFilename, incomingDir } from "@/lib/media/paths";
import { announceClipAdded } from "@/lib/events/clips";

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi",
]);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * A file whose mtime is this recent is assumed to still be arriving. Dropping a
 * multi-gigabyte clip in is not atomic, and the scanner runs on a timer — so
 * catching a file mid-copy is the normal case, not an edge case. Ingesting one
 * yields a truncated read: wrong duration, wrong codecs, or a probe failure
 * that burns all three retries on a file that was never actually broken.
 */
const STABLE_AFTER_MS = 5000;

export async function scanIncoming(
  ctx: JobContext,
  now: number = Date.now(),
): Promise<string[]> {
  const dir = incomingDir(ctx.env);

  if (!existsSync(dir)) {
    return [];
  }

  const created: string[] = [];

  for (const entry of readdirSync(dir)) {
    const ext = extname(entry).toLowerCase();

    if (!VIDEO_EXTENSIONS.has(ext)) {
      continue;
    }

    // A file already named after a ULID is mid-pipeline; leave it alone.
    if (ULID_PATTERN.test(basename(entry, ext))) {
      continue;
    }

    const source = join(dir, entry);

    // One bad file must not abandon the rest of the pass. Without this, a
    // single permission error or a file deleted between readdir and stat would
    // silently strand every later entry until the next scan.
    try {
      const stats = lstatSync(source);

      if (!stats.isFile() || now - stats.mtimeMs < STABLE_AFTER_MS) {
        continue;
      }

      // Queue first in the same transaction as the row. A failed insert leaves
      // the source untouched; a failed rename rolls both database writes back.
      const clip = ctx.db.transaction(() => {
        const clip = createClip(ctx.db, {
          title: basename(entry, ext),
          originalFilename: entry,
          sizeBytes: stats.size,
        });
        enqueueJob(ctx.db, clip.id, "probe");
        renameSync(source, join(dir, clipFilename(clip.id)));
        return clip;
      });

      created.push(clip.id);
    } catch (error) {
      console.error(`ingest: failed to ingest ${entry}`, error);
    }
  }

  // Announced after the loop, not inside it: the loop body is synchronous so
  // the row and its job are already committed by the time we get here.
  for (const id of created) {
    await announceClipAdded(ctx.db, id, ctx.env);
  }

  return created;
}
