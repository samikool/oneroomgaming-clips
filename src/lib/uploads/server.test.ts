import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, type Db } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { jobs, users } from "@/db/schema";
import { createUploadService, progressPercent, UPLOAD_TTL_MS } from "./server";
import { runOnce } from "@/lib/jobs/runner";
import { scanIncoming } from "@/lib/ingest/scan";

let root: string;
let db: Db;
let env: NodeJS.ProcessEnv;
let service: ReturnType<typeof createUploadService>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clips-upload-"));
  db = createDb(":memory:");
  env = { NODE_ENV: "production", MEDIA_ROOT: root };
  service = createUploadService(db, env);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function request(method: string, path = "/api/uploads", extra: Record<string, string> = {}, body?: Uint8Array, owner = "sam") {
  return new Request(`http://localhost${path}`, {
    method, headers: { "tus-resumable": "1.0.0", "x-authentik-username": owner, ...extra },
    body: body as BodyInit | undefined,
  });
}
async function create(size = 6, filename = "ace.mp4", extra = "") {
  const metadata = `filename ${Buffer.from(filename).toString("base64")},title ${Buffer.from("My ace").toString("base64")}${extra}`;
  const res = await service.handle(request("POST", undefined, { "upload-length": String(size), "upload-metadata": metadata }));
  expect(res.status).toBe(201);
  return res.headers.get("location")!;
}
function patch(path: string, offset: number, body: Uint8Array, owner = "sam") {
  return service.handle(request("PATCH", path, { "content-type": "application/offset+octet-stream", "upload-offset": String(offset) }, body, owner));
}

it("resumes after service recreation and hands off exactly once, preserving the owner", async () => {
  const path = await create(6, "ace.mp4", ",owner aGFja2Vy,uploaderId ZmFrZQ==");
  expect((await patch(path, 0, Buffer.from("abc"))).status).toBe(204);
  expect(listAllClips(db)).toHaveLength(0);
  expect(await scanIncoming({ db, env }, Date.now() + 60000)).toEqual([]);
  service = createUploadService(db, env);
  const head = await service.handle(request("HEAD", path));
  expect(head.headers.get("upload-offset")).toBe("3");
  expect((await patch(path, 0, Buffer.from("bad"))).status).toBe(409);
  expect((await patch(path, 3, Buffer.from("def"))).status).toBe(204);
  await service.sweep();
  await service.sweep();
  expect(listAllClips(db)).toHaveLength(1);
  const clip = listAllClips(db)[0];
  expect(clip.title).toBe("My ace");
  expect(clip.uploaderId).toBe(db.select().from(users).get()!.id);
  expect(db.select().from(jobs).all()).toHaveLength(1);
  expect(readFileSync(join(root, "incoming", `${clip.id}.mp4`), "utf8")).toBe("abcdef");
  expect((await service.handle(request("HEAD", path))).headers.get("upload-offset")).toBe("6");
  expect((await service.handle(request("DELETE", path))).status).toBe(400);
});

it("rejects missing auth, cross-origin writes, and other users accessing an upload", async () => {
  expect((await service.handle(request("POST", undefined, {}, undefined, ""))).status).toBe(401);
  expect((await service.handle(request("POST", undefined, { origin: "https://evil.example" }))).status).toBe(403);
  const path = await create();
  for (const method of ["HEAD", "DELETE"]) {
    expect((await service.handle(request(method, path, {}, undefined, "other"))).status).toBe(404);
  }
  expect((await patch(path, 0, Buffer.from("abcdef"), "other")).status).toBe(404);
  expect((await service.handle(request("HEAD", path))).headers.get("upload-offset")).toBe("0");
});

it("rejects invalid names, empty files, and deferred lengths before creating data", async () => {
  for (const filename of ["../clip.mp4", "clip.exe", "a\\b.mp4"]) {
    const res = await service.handle(request("POST", undefined, {
      "upload-length": "6", "upload-metadata": `filename ${Buffer.from(filename).toString("base64")}`,
    }));
    expect(res.status).toBe(400);
  }
  const lengthHeaders: Record<string, string>[] = [{ "upload-length": "0" }, { "upload-defer-length": "1" }];
  for (const headers of lengthHeaders) {
    const res = await service.handle(request("POST", undefined, {
      ...headers, "upload-metadata": "filename YS5tcDQ=",
    }));
    expect(res.status).toBe(400);
  }
});

it("deletes incomplete expired uploads while preserving the published clip source", async () => {
  const incomplete = await create();
  const completed = await create();
  await patch(completed, 0, Buffer.from("abcdef"));
  await service.sweep(Date.now() + UPLOAD_TTL_MS + 1000);
  expect((await service.handle(request("HEAD", incomplete))).status).toBe(404);
  expect((await service.handle(request("HEAD", completed))).status).toBe(404);
  const clip = listAllClips(db)[0];
  expect(existsSync(join(root, "incoming", `${clip.id}.mp4`))).toBe(true);
});

it("recovers completed data if the process stopped before the completion hook", async () => {
  const path = await create();
  const id = path.split("/").at(-1)!;
  await Bun.write(join(root, "incoming", ".uploads", id), "abcdef");
  service = createUploadService(db, env);
  await service.sweep();
  expect(listAllClips(db)[0]?.id).toBe(id);
  expect(db.select().from(jobs).all()).toHaveLength(1);
});

it("processes a real video uploaded in two chunks into a playable clip", async () => {
  const file = join(root, "sample.mp4");
  const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc=duration=2:size=160x90:rate=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", file],
    { stdout: "pipe", stderr: "pipe" });
  expect(await proc.exited).toBe(0);
  const data = readFileSync(file);
  const path = await create(data.length);
  const midpoint = Math.floor(data.length / 2);
  expect((await patch(path, 0, data.subarray(0, midpoint))).status).toBe(204);
  expect((await patch(path, midpoint, data.subarray(midpoint))).status).toBe(204);
  while (await runOnce({ db, env })) { /* drain */ }
  const clip = listAllClips(db)[0];
  expect(clip.status).toBe("ready");
  expect(existsSync(join(root, "clips", `${clip.id}.mp4`))).toBe(true);
  expect(existsSync(join(root, "thumbs", `${clip.id}.jpg`))).toBe(true);
  expect(existsSync(join(root, "incoming", `${clip.id}.mp4`))).toBe(false);
});

describe("progressPercent", () => {
  it("rounds to a whole percentage", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
  });

  it("is 0 at the start and 100 at the end", () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(100, 100)).toBe(100);
  });

  it("returns 0 rather than NaN for an unknown size", () => {
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(10, undefined)).toBe(0);
  });

  it("never exceeds 100 if the offset overshoots", () => {
    expect(progressPercent(120, 100)).toBe(100);
  });
});
