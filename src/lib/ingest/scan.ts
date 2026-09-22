import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClip, deleteClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import type { JobContext } from "@/lib/jobs/types";
import { clipFilename, incomingDir } from "@/lib/media/paths";

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
      const stats = statSync(source);

      if (now - stats.mtimeMs < STABLE_AFTER_MS) {
        continue;
      }

      const clip = createClip(ctx.db, {
        title: basename(entry, ext),
        originalFilename: entry,
        sizeBytes: stats.size,
      });

      try {
        renameSync(source, join(dir, clipFilename(clip.id)));
      } catch (error) {
        // Roll the row back. Leaving it would strand a `pending` clip with no
        // file and no job — and because the source keeps its original name, the
        // next scan would create a SECOND clip for it, which is exactly the
        // duplication the ULID guard exists to prevent.
        deleteClip(ctx.db, clip.id);
        throw error;
      }

      enqueueJob(ctx.db, clip.id, "probe");
      created.push(clip.id);
    } catch (error) {
      console.error(`ingest: failed to ingest ${entry}`, error);
    }
  }

  return created;
}
