import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export class TransformError extends Error {
  constructor(action: string, input: string, detail: string) {
    super(`${action} failed for ${input}: ${detail}`);
    this.name = "TransformError";
  }
}

/**
 * Injectable so the tests can reproduce an ffmpeg that exits 0 without
 * writing anything — which is what ffmpeg 6 does on a past-the-end seek.
 */
export type FfmpegRunner = (action: string, input: string, args: string[]) => Promise<void>;

async function runFfmpeg(action: string, input: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // All three read together: an unread stderr pipe fills its buffer and hangs
  // the process on a large file.
  const [, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new TransformError(action, input, stderr.trim() || `exit code ${exitCode}`);
  }
}

/**
 * Whether ffmpeg actually left a file behind.
 *
 * The exit code is NOT a proxy for this. ffmpeg 6 exits 0 on a past-the-end
 * seek and only warns "Nothing was written into output file", where ffmpeg 8
 * exits non-zero for the same input — so code that branches on the exit code
 * behaves differently depending on which distro it lands on. The file is the
 * contract; the exit code is a hint.
 */
function wroteOutput(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

export async function remuxFaststart(
  input: string,
  output: string,
  run: FfmpegRunner = runFfmpeg,
): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });
  await run("remux", input, ["-i", input, "-c", "copy", "-movflags", "+faststart", output]);

  if (!wroteOutput(output)) {
    // Reporting success here writes a clip row pointing at a file that does
    // not exist, which 404s on playback rather than failing the job.
    throw new TransformError("remux", input, "ffmpeg wrote no output file");
  }
}

export async function extractThumbnail(
  input: string,
  output: string,
  atSeconds = 1,
  run: FfmpegRunner = runFfmpeg,
): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });

  try {
    await run("thumbnail", input, [
      "-ss", String(atSeconds), "-i", input, "-frames:v", "1", "-q:v", "3", output,
    ]);
  } catch {
    // Fall through to the first-frame attempt below.
  }

  if (wroteOutput(output)) {
    return;
  }

  // Seeking past the end yields no frame. Fall back to the first frame so a
  // short clip still gets a tile rather than a broken image. Whether the seek
  // attempt reported failure or claimed success is irrelevant — what matters
  // is that no file arrived.
  await run("thumbnail", input, ["-i", input, "-frames:v", "1", "-q:v", "3", output]);

  if (!wroteOutput(output)) {
    throw new TransformError("thumbnail", input, "ffmpeg wrote no output file");
  }
}
