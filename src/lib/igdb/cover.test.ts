import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverUrl, downloadCoverTo } from "./cover";

describe("downloadCoverTo", () => {
  it("fetches t_cover_big and writes the file atomically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cover-"));
    let asked = "";
    const fn = (async (url: string) => {
      asked = String(url);
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;

    await downloadCoverTo(fn, "co49wj", join(dir, "g.jpg"));
    expect(asked).toBe(coverUrl("co49wj"));
    expect(asked).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/co49wj.jpg");
    expect([...readFileSync(join(dir, "g.jpg"))]).toEqual([1, 2, 3]);
    expect(readdirSync(dir)).toEqual(["g.jpg"]);
  });

  it("leaves nothing behind on a failed download", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cover-"));
    const fn = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(downloadCoverTo(fn, "co49wj", join(dir, "g.jpg"))).rejects.toThrow();
    expect(existsSync(join(dir, "g.jpg"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses an image id that is not plain alphanumerics", async () => {
    const fn = (async () => new Response("")) as unknown as typeof fetch;
    await expect(downloadCoverTo(fn, "../x", "/tmp/never.jpg")).rejects.toThrow("image id");
  });
});
