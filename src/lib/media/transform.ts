import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class TransformError extends Error {
  constructor(action: string, input: string, detail: string) {
    super(`${action} failed for ${input}: ${detail}`);
    this.name = "TransformError";
  }
}

async function runFfmpeg(action: string, input: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new TransformError(action, input, stderr.trim() || `exit code ${exitCode}`);
  }
}

export async function remuxFaststart(input: string, output: string): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });
  await runFfmpeg("remux", input, [
    "-i", input, "-c", "copy", "-movflags", "+faststart", output,
  ]);
}

export async function extractThumbnail(
  input: string,
  output: string,
  atSeconds = 1,
): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });

  try {
    await runFfmpeg("thumbnail", input, [
      "-ss", String(atSeconds), "-i", input, "-frames:v", "1", "-q:v", "3", output,
    ]);
  } catch {
    // Seeking past the end yields no frame. Fall back to the first frame so a
    // short clip still gets a tile rather than a broken image.
    await runFfmpeg("thumbnail", input, [
      "-i", input, "-frames:v", "1", "-q:v", "3", output,
    ]);
  }
}
