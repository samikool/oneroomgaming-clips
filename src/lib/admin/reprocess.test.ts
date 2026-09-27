import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureReprocessSource } from "./reprocess";

let root: string;
let env: { MEDIA_ROOT: string };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reprocess-"));
  env = { MEDIA_ROOT: root };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("ensureReprocessSource", () => {
  it("is ready when the incoming working copy is still there", () => {
    mkdirSync(join(root, "incoming"), { recursive: true });
    writeFileSync(join(root, "incoming", "c1.mp4"), "src");
    expect(ensureReprocessSource(env, "c1")).toBe(true);
  });

  it("copies the published file back into incoming when the working copy is gone", () => {
    mkdirSync(join(root, "clips"), { recursive: true });
    writeFileSync(join(root, "clips", "c1.mp4"), "published");
    expect(ensureReprocessSource(env, "c1")).toBe(true);
    expect(readFileSync(join(root, "incoming", "c1.mp4"), "utf8")).toBe("published");
    // A copy, not a link: remux writes clips/<id>.mp4 while reading incoming/<id>.mp4.
    writeFileSync(join(root, "incoming", "c1.mp4"), "changed");
    expect(readFileSync(join(root, "clips", "c1.mp4"), "utf8")).toBe("published");
  });

  it("is not ready when neither file exists", () => {
    expect(ensureReprocessSource(env, "c1")).toBe(false);
    expect(existsSync(join(root, "incoming", "c1.mp4"))).toBe(false);
  });
});
