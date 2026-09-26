import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip, setClipStatus } from "@/db/clips";
import { browseTabs, parseScope, parseTabs } from "./tabs";
import { parseBrowseQuery } from "./query";

describe("parseTabs", () => {
  it("reads a comma list, drops unknowns and duplicates, keeps order", () => {
    expect(parseTabs("new,top,bogus,new", "new")).toEqual(["new", "top"]);
  });

  it("falls back to the current sort", () => {
    expect(parseTabs(null, "random")).toEqual(["random"]);
    expect(parseTabs("bogus", "top")).toEqual(["top"]);
  });
});

describe("parseScope", () => {
  it("defaults to home", () => {
    expect(parseScope("theater")).toBe("theater");
    expect(parseScope("x")).toBe("home");
  });
});

describe("browseTabs", () => {
  let db: Db;
  let sam: string;

  beforeEach(() => {
    db = createDb(":memory:");
    sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    for (let i = 0; i < 3; i++) {
      const c = createClip(db, { title: `c${i}`, originalFilename: "x.mp4", sizeBytes: 1, uploaderId: sam }, new Date(i));
      setClipStatus(db, c.id, "ready");
    }
  });

  it("returns a page for each requested tab", () => {
    const out = browseTabs(db, parseBrowseQuery({}), { tabs: ["new", "top", "random", "trending"], scope: "home", userId: sam });
    expect(Object.keys(out.tabs).sort()).toEqual(["new", "random", "top", "trending"]);
    expect(out.tabs.new!.clips).toHaveLength(3);
    expect(out.tabs.trending!.clips).toHaveLength(0);
  });

  it("applies a cursor only when exactly one tab is requested", () => {
    const one = browseTabs(db, parseBrowseQuery({}), { tabs: ["new"], scope: "home", userId: sam, cursor: "garbage" });
    expect(one.tabs.new!.clips).toHaveLength(3);
  });
});
