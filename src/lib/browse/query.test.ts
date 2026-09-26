import { describe, expect, it } from "bun:test";
import { isFiltered, parseBrowseQuery, serializeBrowseQuery } from "./query";

describe("parseBrowseQuery", () => {
  it("defaults to New with nothing set", () => {
    expect(parseBrowseQuery({})).toMatchObject({ sort: "new", q: "", games: [], tags: [], people: [] });
  });

  it("reads repeated params as lists", () => {
    const q = parseBrowseQuery(new URLSearchParams("sort=top&game=apex&game=valorant&tag=Clutch&person=sam"));
    expect(q).toMatchObject({ sort: "top", games: ["apex", "valorant"], tags: ["clutch"], people: ["sam"] });
  });

  it("maps legacy uploader and participant into people, without duplicates", () => {
    expect(parseBrowseQuery({ uploader: "sam", participant: ["kobe", "sam"] }).people).toEqual(["sam", "kobe"]);
  });

  it("falls back on junk", () => {
    const q = parseBrowseQuery({ sort: "hot", seed: "abc", q: "x".repeat(300) });
    expect(q.sort).toBe("new");
    expect(q.q.length).toBe(100);
    expect(Number.isInteger(q.seed)).toBe(true);
  });

  it("drops empty values and trims", () => {
    expect(parseBrowseQuery({ game: ["", "  apex "], q: "  hi  " })).toMatchObject({ games: ["apex"], q: "hi" });
  });
});

describe("serializeBrowseQuery", () => {
  it("round-trips with a stable key order", () => {
    const q = parseBrowseQuery(new URLSearchParams("person=sam&game=valorant&game=apex&sort=top&q=kobe"));
    const text = serializeBrowseQuery(q);
    expect(text).toBe("sort=top&q=kobe&game=valorant&game=apex&person=sam");
    expect(parseBrowseQuery(new URLSearchParams(text))).toMatchObject({ ...q, seed: expect.any(Number) });
  });

  it("omits defaults", () => {
    expect(serializeBrowseQuery(parseBrowseQuery({}))).toBe("");
  });

  it("includes the seed only when asked", () => {
    const q = { ...parseBrowseQuery({ sort: "random" }), seed: 42 };
    expect(serializeBrowseQuery(q)).toBe("sort=random");
    expect(serializeBrowseQuery(q, { includeSeed: true })).toBe("sort=random&seed=42");
  });
});

describe("isFiltered", () => {
  it("is true for a search or any filter", () => {
    expect(isFiltered(parseBrowseQuery({}))).toBe(false);
    expect(isFiltered(parseBrowseQuery({ q: "x" }))).toBe(true);
    expect(isFiltered(parseBrowseQuery({ tag: "x" }))).toBe(true);
    expect(isFiltered(parseBrowseQuery({ sort: "top" }))).toBe(false);
  });
});
