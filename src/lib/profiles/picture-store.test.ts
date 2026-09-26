import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { getProfile } from "@/db/profiles";
import { PictureRejectedError, removePicture, savePicture } from "./picture-store";

let db: Db;
let root: string;
const webp = (w: number, h: number) => async () => ({ videoCodec: "webp", width: w, height: h });
// Each call is probed once per file: first the 256, then the 64.
function probeSizes() {
  const sizes = [256, 64];
  let i = 0;
  return async () => {
    const s = sizes[i++ % 2];
    return { videoCodec: "webp", width: s, height: s };
  };
}
const bytes = (n: number) => new Uint8Array(n).fill(7);

beforeEach(() => {
  db = createDb(":memory:");
  upsertUser(db, { username: "sam", email: null, displayName: null });
  root = mkdtempSync(join(tmpdir(), "avatars-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = () => ({ MEDIA_ROOT: root });

describe("savePicture", () => {
  it("stores both sizes and bumps the version", async () => {
    const profile = await savePicture(db, "sam", { s256: bytes(100), s64: bytes(50) }, { probe: probeSizes(), env: env() });
    expect(profile.pictureVersion).toBe(1);
    expect(readdirSync(join(root, "avatars")).sort()).toEqual([
      `${profile.userId}-1-256.webp`,
      `${profile.userId}-1-64.webp`,
    ]);
  });

  it("removes the previous version's files only after the new ones are in place", async () => {
    await savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: probeSizes(), env: env() });
    const second = await savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: probeSizes(), env: env() });
    expect(second.pictureVersion).toBe(2);
    expect(readdirSync(join(root, "avatars")).sort()).toEqual([
      `${second.userId}-2-256.webp`,
      `${second.userId}-2-64.webp`,
    ]);
  });

  it("gives two racing uploads distinct versions and keeps only the last one's files", async () => {
    // A probe that yields, so both saves are in flight at once.
    function slowProbe() {
      const next = probeSizes();
      return async (path: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return next();
      };
    }
    const [a, b] = await Promise.all([
      savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: slowProbe(), env: env() }),
      savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: slowProbe(), env: env() }),
    ]);
    expect([a.pictureVersion, b.pictureVersion].sort()).toEqual([1, 2]);
    expect(getProfile(db, "sam")?.pictureVersion).toBe(2);
    expect(readdirSync(join(root, "avatars")).sort()).toEqual([`${a.userId}-2-256.webp`, `${a.userId}-2-64.webp`]);
  });

  it("rejects oversize files without touching the current picture", async () => {
    const first = await savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: probeSizes(), env: env() });
    await expect(
      savePicture(db, "sam", { s256: bytes(204801), s64: bytes(10) }, { probe: probeSizes(), env: env() }),
    ).rejects.toBeInstanceOf(PictureRejectedError);
    expect(getProfile(db, "sam")?.pictureVersion).toBe(first.pictureVersion);
  });

  it("rejects a non-WebP disguised by its name", async () => {
    const probe = async () => ({ videoCodec: "png", width: 256, height: 256 });
    await expect(
      savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe, env: env() }),
    ).rejects.toBeInstanceOf(PictureRejectedError);
    expect(readdirSync(join(root, "avatars"))).toEqual([]);
  });

  it("rejects the wrong dimensions", async () => {
    await expect(
      savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: webp(300, 300), env: env() }),
    ).rejects.toBeInstanceOf(PictureRejectedError);
  });

  it("rejects a file ffprobe cannot read", async () => {
    const probe = async () => {
      throw new Error("ffprobe failed");
    };
    await expect(
      savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe, env: env() }),
    ).rejects.toBeInstanceOf(PictureRejectedError);
  });
});

describe("savePicture with the real ffprobe", () => {
  async function encode(size: number, format: "webp" | "png"): Promise<Uint8Array> {
    const out = join(root, `src-${size}.${format}`);
    const proc = Bun.spawn(
      ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=red:s=${size}x${size}`, "-frames:v", "1", out],
      { stdout: "ignore", stderr: "pipe" },
    );
    expect(await proc.exited).toBe(0);
    return new Uint8Array(await Bun.file(out).arrayBuffer());
  }

  it("accepts a genuine WebP pair", async () => {
    const profile = await savePicture(db, "sam", { s256: await encode(256, "webp"), s64: await encode(64, "webp") }, { env: env() });
    expect(profile.pictureVersion).toBe(1);
  });

  it("rejects a PNG however it is labelled", async () => {
    await expect(
      savePicture(db, "sam", { s256: await encode(256, "png"), s64: await encode(64, "png") }, { env: env() }),
    ).rejects.toBeInstanceOf(PictureRejectedError);
    expect(getProfile(db, "sam")?.pictureVersion).toBeNull();
  });
});

describe("removePicture", () => {
  it("clears the version and deletes the files", async () => {
    const saved = await savePicture(db, "sam", { s256: bytes(10), s64: bytes(10) }, { probe: probeSizes(), env: env() });
    const cleared = await removePicture(db, "sam", { env: env() });
    expect(cleared.pictureVersion).toBeNull();
    expect(existsSync(join(root, "avatars", `${saved.userId}-1-256.webp`))).toBe(false);
  });
});
