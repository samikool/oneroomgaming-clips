import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { jobs as jobsTable } from "@/db/schema";
import { scanIncoming } from "@/lib/ingest/scan";

let root: string;
let db: Db;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clips-scan-"));
  mkdirSync(join(root, "incoming"), { recursive: true });
  env = { MEDIA_ROOT: root };
  db = createDb(":memory:");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanIncoming", () => {
  it("creates a clip and a probe job for a video file", async () => {
    writeFileSync(join(root, "incoming", "ace round.mp4"), "x");

    const created = await scanIncoming({ db, env }, Date.now() + 60_000);

    expect(created).toHaveLength(1);
    const clip = listAllClips(db)[0];
    expect(clip.title).toBe("ace round");
    expect(clip.originalFilename).toBe("ace round.mp4");
    expect(db.select().from(jobsTable).get()?.type).toBe("probe");
  });

  it("renames the file to the clip id so handlers can find it", async () => {
    writeFileSync(join(root, "incoming", "x.mp4"), "x");

    const [id] = await scanIncoming({ db, env }, Date.now() + 60_000);

    expect(existsSync(join(root, "incoming", `${id}.mp4`))).toBe(true);
    expect(existsSync(join(root, "incoming", "x.mp4"))).toBe(false);
  });

  it("ignores files that are not videos", async () => {
    writeFileSync(join(root, "incoming", "notes.txt"), "x");
    writeFileSync(join(root, "incoming", ".DS_Store"), "x");

    expect(await scanIncoming({ db, env }, Date.now() + 60_000)).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(0);
  });

  it("does not re-ingest a file it already renamed", async () => {
    writeFileSync(join(root, "incoming", "x.mp4"), "x");
    await scanIncoming({ db, env }, Date.now() + 60_000);

    expect(await scanIncoming({ db, env }, Date.now() + 60_000)).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(1);
  });

  it("returns an empty list when the incoming directory does not exist", async () => {
    rmSync(join(root, "incoming"), { recursive: true, force: true });
    expect(await scanIncoming({ db, env }, Date.now() + 60_000)).toHaveLength(0);
  });

  it("skips a file that is still being written", async () => {
    writeFileSync(join(root, "incoming", "arriving.mp4"), "x");

    // Default `now` — the file's mtime is milliseconds old.
    expect(await scanIncoming({ db, env })).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(0);
  });
});
