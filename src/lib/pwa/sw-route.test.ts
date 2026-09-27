import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isOfflineFallback, swDecision } from "./sw-route";

const O = "https://clips.oneroomgaming.com";

describe("swDecision", () => {
  it("handles only same-origin GET navigations", () => {
    expect(swDecision({ mode: "navigate", method: "GET", url: `${O}/theater` }, O)).toBe("network-with-offline-fallback");
    expect(swDecision({ mode: "cors", method: "GET", url: `${O}/api/clips/browse` }, O)).toBe("passthrough");
    expect(swDecision({ mode: "no-cors", method: "GET", url: `${O}/media/clips/x.mp4` }, O)).toBe("passthrough");
    expect(swDecision({ mode: "navigate", method: "POST", url: `${O}/` }, O)).toBe("passthrough");
    expect(swDecision({ mode: "navigate", method: "GET", url: "https://auth.oneroomgaming.com/flows/x" }, O)).toBe("passthrough");
    expect(swDecision({ mode: "websocket", method: "GET", url: `${O}/ws` }, O)).toBe("passthrough");
    expect(swDecision({ mode: "same-origin", method: "GET", url: `${O}/manifest.webmanifest` }, O)).toBe("passthrough");
  });
});

describe("isOfflineFallback", () => {
  it("falls back only on a network error, never on a response — including the Authentik redirect", () => {
    expect(isOfflineFallback({ ok: false })).toBe(true);
    expect(isOfflineFallback({ ok: true, status: 0, type: "opaqueredirect" })).toBe(false);
    expect(isOfflineFallback({ ok: true, status: 302, type: "basic" })).toBe(false);
    expect(isOfflineFallback({ ok: true, status: 401, type: "basic" })).toBe(false);
    expect(isOfflineFallback({ ok: true, status: 500, type: "basic" })).toBe(false);
  });
});

describe("public/sw.js", () => {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

  it("precaches only the offline page", () => {
    expect(source.match(/cache\.add(All)?\(/g)).toEqual(["cache.add("]);
    expect(source).toContain('cache.add("/offline.html")');
    expect(source).not.toMatch(/cache\.put\(/);
  });

  it("returns the network's own response and falls back only in the fetch's catch", () => {
    expect(source).toContain('fetch(req).catch(() => caches.match("/offline.html"))');
    expect(source).not.toMatch(/redirect:\s*["']manual/);
  });
});
