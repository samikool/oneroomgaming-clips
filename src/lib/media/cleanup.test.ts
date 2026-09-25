import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeClipFiles, removeSourceArtifacts } from "@/lib/media/cleanup";

let root: string;
let env: Partial<NodeJS.ProcessEnv>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clips-cleanup-"));
  for (const dir of ["incoming", "incoming/.uploads", "clips", "thumbs"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  env = { MEDIA_ROOT: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedEveryFile(id: string) {
  writeFileSync(join(root, "clips", `${id}.mp4`), "published");
  writeFileSync(join(root, "thumbs", `${id}.jpg`), "thumb");
  writeFileSync(join(root, "incoming", `${id}.mp4`), "working copy");
  writeFileSync(join(root, "incoming", ".uploads", id), "tus entry");
}

describe("removeSourceArtifacts", () => {
  it("leaves the published clip and thumb alone", () => {
    seedEveryFile("01AAA");

    removeSourceArtifacts(env, "01AAA");

    expect(existsSync(join(root, "clips", "01AAA.mp4"))).toBe(true);
    expect(existsSync(join(root, "thumbs", "01AAA.jpg"))).toBe(true);
    expect(existsSync(join(root, "incoming", "01AAA.mp4"))).toBe(false);
  });
});

describe("removeClipFiles", () => {
  it("removes the published video and its thumbnail", () => {
    seedEveryFile("01AAA");

    removeClipFiles(env, "01AAA");

    expect(existsSync(join(root, "clips", "01AAA.mp4"))).toBe(false);
    expect(existsSync(join(root, "thumbs", "01AAA.jpg"))).toBe(false);
  });

  it("also removes the pre-publish source artefacts", () => {
    seedEveryFile("01AAA");

    removeClipFiles(env, "01AAA");

    expect(existsSync(join(root, "incoming", "01AAA.mp4"))).toBe(false);
    expect(existsSync(join(root, "incoming", ".uploads", "01AAA"))).toBe(false);
  });

  it("leaves other clips' files alone", () => {
    seedEveryFile("01AAA");
    seedEveryFile("01BBB");

    removeClipFiles(env, "01AAA");

    expect(existsSync(join(root, "clips", "01BBB.mp4"))).toBe(true);
    expect(existsSync(join(root, "thumbs", "01BBB.jpg"))).toBe(true);
  });

  // Called after the database row is already gone, so it must never throw:
  // a clip that failed before producing a thumbnail has no thumbnail.
  it("does not throw when the files were never written", () => {
    expect(() => removeClipFiles(env, "01MISSING")).not.toThrow();
  });

  it("is safe to call twice", () => {
    seedEveryFile("01AAA");

    removeClipFiles(env, "01AAA");

    expect(() => removeClipFiles(env, "01AAA")).not.toThrow();
  });
});
