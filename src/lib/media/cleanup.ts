import { rmSync } from "node:fs";
import { join } from "node:path";
import { clipFilename, clipsDir, incomingDir, thumbFilename, thumbsDir } from "./paths";

/**
 * Removes a clip's pre-publish source artefacts: the working copy at
 * incoming/<id>.mp4 and the tus staging entry at incoming/.uploads/<id>, if
 * either exists. Safe to call more than once, or when neither was ever
 * written. Never touches clips/<id>.mp4 — that is the published file.
 */
export function removeSourceArtifacts(
  env: Partial<NodeJS.ProcessEnv>,
  clipId: string,
): void {
  const incoming = incomingDir(env);
  rmSync(join(incoming, clipFilename(clipId)), { force: true });
  rmSync(join(incoming, ".uploads", clipId), { force: true });
}

/**
 * Removes every file a clip owns: the published video, its thumbnail, and any
 * pre-publish artefacts still lying around.
 *
 * Called AFTER `deleteClipCascade` has committed, so it must never throw — by
 * then the row is already gone and there is nothing to roll back to. Every
 * unlink is `force`, because a clip that failed before producing a thumbnail
 * legitimately has no thumbnail, and calling this twice is not an error.
 *
 * Consequence to accept: if an unlink fails the bytes are orphaned on disk.
 * That is the direction to fail in — the alternative ordering leaves a row
 * pointing at a video that is gone, which renders as a broken card.
 */
export function removeClipFiles(
  env: Partial<NodeJS.ProcessEnv>,
  clipId: string,
): void {
  rmSync(join(clipsDir(env), clipFilename(clipId)), { force: true });
  rmSync(join(thumbsDir(env), thumbFilename(clipId)), { force: true });
  removeSourceArtifacts(env, clipId);
}
