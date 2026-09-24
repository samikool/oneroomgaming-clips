import { rmSync } from "node:fs";
import { join } from "node:path";
import { clipFilename, incomingDir } from "./paths";

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
