import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "./manifest";

describe("manifest", () => {
  it("is installable: name, start_url, standalone, icons incl. maskable", () => {
    const m = manifest();
    expect(m).toMatchObject({ name: "One Room Gaming Clips", short_name: "clips", start_url: "/", scope: "/", display: "standalone" });
    const sizes = m.icons!.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("points only at icons that exist in public/", () => {
    for (const icon of manifest().icons!) {
      expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
    }
  });
});
