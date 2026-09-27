import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { clips, users } from "@/db/schema";
import { avatarsDir } from "@/lib/profiles/picture";

export type UploaderStorage = { username: string | null; clips: number; bytes: number; share: number };

/**
 * Bytes per uploader, biggest first. A clip with no recorded size counts 0;
 * clips with no uploader (the ingest scan's) group under null. Shares are of
 * the library total and sum to 1, or are all 0 when the total is.
 */
export function storageByUploader(db: Db): UploaderStorage[] {
  const rows = db
    .select({
      username: users.authentikUsername,
      clips: count(clips.id),
      bytes: sql<number>`coalesce(sum(${clips.sizeBytes}), 0)`,
    })
    .from(clips)
    .leftJoin(users, eq(users.id, clips.uploaderId))
    .groupBy(clips.uploaderId)
    .all();

  const total = rows.reduce((sum, row) => sum + row.bytes, 0);

  return rows
    .map((row) => ({ ...row, share: total === 0 ? 0 : row.bytes / total }))
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        Number(a.username === null) - Number(b.username === null) ||
        (a.username ?? "").localeCompare(b.username ?? ""),
    );
}

/** Everything under MEDIA_ROOT/avatars, in bytes. 0 when the folder doesn't exist yet. */
export function avatarsBytes(env: Partial<NodeJS.ProcessEnv> = process.env): number {
  const dir = avatarsDir(env);
  let entries: string[];

  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return 0;
  }

  let total = 0;

  for (const entry of entries) {
    try {
      const stat = statSync(join(dir, entry));
      if (stat.isFile()) {
        total += stat.size;
      }
    } catch {
      // Removed between the listing and the stat: it no longer takes space.
    }
  }

  return total;
}
