import { describe, expect, it } from "bun:test";
import { parseBrowseQuery } from "./query";
import { browseUrl, fetchTabs } from "./client";

describe("browseUrl", () => {
  it("includes the query, scope, tabs and cursor", () => {
    const q = { ...parseBrowseQuery({ q: "kobe", game: "apex", sort: "random" }), seed: 5 };
    expect(browseUrl(q, { scope: "theater", tabs: ["new", "top"] })).toBe(
      "/api/clips/browse?sort=random&q=kobe&game=apex&seed=5&scope=theater&tabs=new%2Ctop",
    );
    expect(browseUrl(q, { scope: "home", tabs: ["new"], cursor: "abc" })).toContain("&cursor=abc");
  });

  it("always carries the seed, so Random pages continue one shuffle", () => {
    const q = { ...parseBrowseQuery({}), seed: 9 };
    expect(browseUrl(q, { scope: "home", tabs: ["random"] })).toBe("/api/clips/browse?seed=9&scope=home&tabs=random");
  });
});

describe("fetchTabs", () => {
  it("throws on a non-2xx so the caller can show retry", async () => {
    const failing = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchTabs(parseBrowseQuery({}), { scope: "home", tabs: ["new"] }, failing)).rejects.toThrow();
  });

  it("returns the tabs on success", async () => {
    const ok = (async () => Response.json({ tabs: { new: { clips: [], next: null } } })) as unknown as typeof fetch;
    expect(await fetchTabs(parseBrowseQuery({}), { scope: "home", tabs: ["new"] }, ok)).toEqual({
      tabs: { new: { clips: [], next: null } },
    });
  });
});
