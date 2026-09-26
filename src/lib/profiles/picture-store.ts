import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@/db/client";
import { getProfile, setPictureVersion, type Profile } from "@/db/profiles";
import { probeFile, type MediaInfo } from "@/lib/media/probe";
import { avatarsDir, pictureFilename, type PictureSize } from "./picture";

export const PICTURE_MAX_BYTES = 200 * 1024;

export class PictureRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PictureRejectedError";
  }
}

type Probe = (path: string) => Promise<Pick<MediaInfo, "videoCodec" | "width" | "height">>;
type Deps = { probe?: Probe; env?: Partial<NodeJS.ProcessEnv> };

function writeDurably(path: string, data: Uint8Array): void {
  writeFileSync(path, data);
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeVersion(dir: string, userId: string, version: number | null): void {
  if (version === null) {
    return;
  }
  for (const size of [256, 64] as const) {
    rmSync(join(dir, pictureFilename(userId, version, size)), { force: true });
  }
}

// One picture change per person at a time. Without this, two uploads that
// both read version 1 would both write version 2: the same URL would end up
// holding different pictures, and a browser that cached the first would never
// see the second. The web server is a single process, so an in-memory queue is
// enough.
const pictureQueues = new Map<string, Promise<unknown>>();

function oneAtATime<T>(username: string, task: () => Promise<T>): Promise<T> {
  const previous = pictureQueues.get(username) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => {});
  pictureQueues.set(username, settled);
  void settled.then(() => {
    if (pictureQueues.get(username) === settled) {
      pictureQueues.delete(username);
    }
  });
  return run;
}

/**
 * Stores a new profile picture. The files are checked with ffprobe rather
 * than trusted by name, written under temporary names, and renamed into place
 * before the version moves. The old version's files go last, so a crash can
 * leave an orphan file but never a profile pointing at a missing one.
 */
export function savePicture(
  db: Db,
  username: string,
  files: { s256: Uint8Array; s64: Uint8Array },
  deps: Deps = {},
): Promise<Profile> {
  return oneAtATime(username, () => storePicture(db, username, files, deps));
}

async function storePicture(
  db: Db,
  username: string,
  files: { s256: Uint8Array; s64: Uint8Array },
  { probe = probeFile, env = process.env }: Deps,
): Promise<Profile> {
  const current = getProfile(db, username);

  if (!current) {
    throw new Error(`No user ${username}`);
  }

  const dir = avatarsDir(env);
  mkdirSync(dir, { recursive: true });

  const next = (current.pictureVersion ?? 0) + 1;
  const parts: [PictureSize, Uint8Array][] = [
    [256, files.s256],
    [64, files.s64],
  ];
  const temps: string[] = [];

  try {
    for (const [size, data] of parts) {
      if (data.byteLength === 0 || data.byteLength > PICTURE_MAX_BYTES) {
        throw new PictureRejectedError("That picture is too large.");
      }

      const temp = join(dir, `.upload-${current.userId}-${next}-${size}-${crypto.randomUUID()}`);
      temps.push(temp);
      writeDurably(temp, data);

      let info: Awaited<ReturnType<Probe>>;
      try {
        info = await probe(temp);
      } catch {
        throw new PictureRejectedError("That file isn't a picture we can read.");
      }

      if (info.videoCodec !== "webp" || info.width !== size || info.height !== size) {
        throw new PictureRejectedError("That file isn't the picture we expected.");
      }
    }

    parts.forEach(([size], i) => renameSync(temps[i], join(dir, pictureFilename(current.userId, next, size))));
  } catch (error) {
    for (const temp of temps) {
      rmSync(temp, { force: true });
    }
    throw error;
  }

  const updated = setPictureVersion(db, username, next);
  removeVersion(dir, current.userId, current.pictureVersion);

  return updated;
}

export function removePicture(
  db: Db,
  username: string,
  { env = process.env }: Pick<Deps, "env"> = {},
): Promise<Profile> {
  return oneAtATime(username, async () => {
    const current = getProfile(db, username);

    if (!current) {
      throw new Error(`No user ${username}`);
    }

    const updated = setPictureVersion(db, username, null);
    removeVersion(avatarsDir(env), current.userId, current.pictureVersion);

    return updated;
  });
}
