import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { clipFilename, clipsDir, incomingDir } from "@/lib/media/paths";

/**
 * Makes sure the probe stage has a file to read before a clip is reprocessed.
 *
 * The pipeline reads `incoming/<id>.mp4`, and a clip that failed for good has
 * had that working copy removed. When the clip got far enough to publish
 * `clips/<id>.mp4`, that file is copied back — a copy, never a hard link,
 * because remux then rewrites `clips/<id>.mp4` while reading the working
 * copy. With neither, there's nothing to reprocess and the answer is false.
 */
export function ensureReprocessSource(env: Partial<NodeJS.ProcessEnv>, clipId: string): boolean {
  const incoming = join(incomingDir(env), clipFilename(clipId));

  if (existsSync(incoming)) {
    return true;
  }

  const published = join(clipsDir(env), clipFilename(clipId));

  if (!existsSync(published)) {
    return false;
  }

  mkdirSync(incomingDir(env), { recursive: true });
  copyFileSync(published, incoming);
  return true;
}
