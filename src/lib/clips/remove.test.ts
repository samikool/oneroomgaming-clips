import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { createClip, getClip, listAllClips } from "@/db/clips";
import { addComment, listComments } from "@/db/comments";
import { upsertUser } from "@/db/users";
import { removeClips } from "@/lib/clips/remove";

let db: Db;
let root: string;
let env: Partial<NodeJS.ProcessEnv>;
const originalFetch = globalThis.fetch;

function captureFetch() {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

beforeEach(() => {
  db = createDb(":memory:");
  root = mkdtempSync(join(tmpdir(), "clips-remove-"));
  for (const dir of ["incoming", "incoming/.uploads", "clips", "thumbs"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  env = { MEDIA_ROOT: root, REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s3cret" };
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

function seed(id: string) {
  const clip = createClip(db, {
    id, title: id, originalFilename: `${id}.mp4`, sizeBytes: 100,
  });
  writeFileSync(join(root, "clips", `${id}.mp4`), "video");
  writeFileSync(join(root, "thumbs", `${id}.jpg`), "thumb");
  return clip;
}

describe("removeClips", () => {
  it("removes the clip row", async () => {
    const clip = seed("01AAA");
    captureFetch();

    await removeClips(db, env, [clip.id]);

    expect(getClip(db, clip.id)).toBeUndefined();
  });

  it("removes the clip's files from disk", async () => {
    seed("01AAA");
    captureFetch();

    await removeClips(db, env, ["01AAA"]);

    expect(existsSync(join(root, "clips", "01AAA.mp4"))).toBe(false);
    expect(existsSync(join(root, "thumbs", "01AAA.jpg"))).toBe(false);
  });

  it("removes child rows along with the clip", async () => {
    const clip = seed("01AAA");
    const user = upsertUser(db, { username: "sam", email: null, displayName: null });
    addComment(db, { clipId: clip.id, userId: user.id, body: "bye" });
    captureFetch();

    await removeClips(db, env, [clip.id]);

    expect(listComments(db, clip.id)).toHaveLength(0);
  });

  it("announces one clip.removed per clip actually removed", async () => {
    seed("01AAA");
    seed("01BBB");
    const bodies = captureFetch();

    await removeClips(db, env, ["01AAA", "01BBB"]);

    expect(bodies).toEqual([
      { t: "clip.removed", clipId: "01AAA" },
      { t: "clip.removed", clipId: "01BBB" },
    ]);
  });

  it("returns the ids it actually removed", async () => {
    seed("01AAA");
    captureFetch();

    expect(await removeClips(db, env, ["01AAA"])).toEqual(["01AAA"]);
  });

  // Two admins deleting at once, or a double-submit. Neither should error.
  it("skips an id that is already gone and does not announce it", async () => {
    seed("01AAA");
    const bodies = captureFetch();

    const removed = await removeClips(db, env, ["01GONE", "01AAA"]);

    expect(removed).toEqual(["01AAA"]);
    expect(bodies).toEqual([{ t: "clip.removed", clipId: "01AAA" }]);
  });

  it("leaves clips that were not asked for alone", async () => {
    seed("01AAA");
    seed("01KEEP");
    captureFetch();

    await removeClips(db, env, ["01AAA"]);

    expect(listAllClips(db).map((c) => c.id)).toEqual(["01KEEP"]);
    expect(existsSync(join(root, "clips", "01KEEP.mp4"))).toBe(true);
  });

  it("does nothing and announces nothing for an empty selection", async () => {
    seed("01AAA");
    const bodies = captureFetch();

    expect(await removeClips(db, env, [])).toEqual([]);
    expect(bodies).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(1);
  });

  // The same property the rest of the pipeline has: realtime is a nicety.
  it("still deletes when realtime is unreachable", async () => {
    seed("01AAA");
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const removed = await removeClips(db, env, ["01AAA"]);

    expect(removed).toEqual(["01AAA"]);
    expect(getClip(db, "01AAA")).toBeUndefined();
    expect(existsSync(join(root, "clips", "01AAA.mp4"))).toBe(false);
  });
});
