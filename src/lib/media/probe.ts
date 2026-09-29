import { statSync } from "node:fs";

export type MediaInfo = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  /** ffprobe's `pix_fmt`. Browsers only decode 8-bit 4:2:0 H.264. */
  pixelFormat: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  container: string | null;
  sizeBytes: number;
  /** The container's creation_time, epoch ms; not every recorder writes one. */
  createdAt?: number | null;
};

export class ProbeError extends Error {
  constructor(path: string, detail: string) {
    super(`ffprobe failed for ${path}: ${detail}`);
    this.name = "ProbeError";
  }
}

type FfStream = {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
};

export function parseCreationTime(tags: Record<string, string> | undefined): number | null {
  const raw = tags?.creation_time;
  const ms = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

export async function probeFile(path: string): Promise<MediaInfo> {
  let sizeBytes: number;

  try {
    sizeBytes = statSync(path).size;
  } catch {
    throw new ProbeError(path, "file does not exist");
  }

  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error", "-print_format", "json",
      "-show_format", "-show_streams", path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    // A bare exit code once hid an SMB open failure ("Invalid argument") for
    // a whole import, so the reason goes into the job's error.
    const reason = stderr.trim().split("\n").at(-1);
    throw new ProbeError(path, reason ? `exit code ${exitCode}: ${reason}` : `exit code ${exitCode}`);
  }

  let parsed: { streams?: FfStream[]; format?: Record<string, string> & { tags?: Record<string, string> } };

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ProbeError(path, "output was not valid JSON");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  if (!video) {
    throw new ProbeError(path, "no video stream found");
  }

  const duration = Number(parsed.format?.duration);
  const bitrate = Number(parsed.format?.bit_rate);

  return {
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: video.width ?? null,
    height: video.height ?? null,
    videoCodec: video.codec_name ?? null,
    pixelFormat: video.pix_fmt ?? null,
    audioCodec: audio?.codec_name ?? null,
    bitrate: Number.isFinite(bitrate) ? bitrate : null,
    container: parsed.format?.format_name ?? null,
    sizeBytes,
    createdAt: parseCreationTime(parsed.format?.tags),
  };
}
