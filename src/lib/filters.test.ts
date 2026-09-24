import { describe, expect, it } from "bun:test";
import {
  activeFilters,
  filtersToQuery,
  parseFilters,
  withFilter,
  withoutFilter,
} from "@/lib/filters";

describe("parseFilters", () => {
  it("is empty for no params", () => {
    expect(parseFilters({})).toEqual({});
  });

  it("reads the four filterable fields", () => {
    expect(
      parseFilters({ tag: "ace", game: "valorant", uploader: "sam", participant: "dave" }),
    ).toEqual({ tag: "ace", game: "valorant", uploader: "sam", participant: "dave" });
  });

  it("ignores params it does not know", () => {
    expect(parseFilters({ tag: "ace", nonsense: "x" })).toEqual({ tag: "ace" });
  });

  it("takes the first value when a param is repeated", () => {
    // Next hands back an array for ?tag=a&tag=b. One filter per field keeps
    // both the query and the chips simple.
    expect(parseFilters({ tag: ["ace", "clutch"] })).toEqual({ tag: "ace" });
  });

  it("drops an empty value rather than filtering on nothing", () => {
    expect(parseFilters({ tag: "", game: "  " })).toEqual({});
  });
});

describe("filtersToQuery", () => {
  it("is empty for no filters", () => {
    expect(filtersToQuery({})).toBe("/");
  });

  it("renders a linkable query in a stable order", () => {
    // Stable order means the same filter set is always the same URL, which is
    // what makes it comparable and cacheable.
    expect(filtersToQuery({ game: "valorant", tag: "ace" })).toBe("/?tag=ace&game=valorant");
  });

  it("encodes values", () => {
    expect(filtersToQuery({ game: "counter strike" })).toBe("/?game=counter+strike");
  });
});

describe("withFilter", () => {
  it("adds to what is already there", () => {
    expect(withFilter({ tag: "ace" }, "game", "valorant")).toBe("/?tag=ace&game=valorant");
  });

  it("replaces a field rather than accumulating", () => {
    expect(withFilter({ tag: "ace" }, "tag", "clutch")).toBe("/?tag=clutch");
  });
});

describe("withoutFilter", () => {
  it("removes one and keeps the rest", () => {
    expect(withoutFilter({ tag: "ace", game: "valorant" }, "tag")).toBe("/?game=valorant");
  });

  it("goes back to the bare grid when the last one goes", () => {
    expect(withoutFilter({ tag: "ace" }, "tag")).toBe("/");
  });
});

describe("activeFilters", () => {
  it("lists what is set, in the display order", () => {
    expect(activeFilters({ game: "valorant", tag: "ace" })).toEqual([
      { key: "tag", value: "ace" },
      { key: "game", value: "valorant" },
    ]);
  });

  it("is empty when nothing is set", () => {
    expect(activeFilters({})).toEqual([]);
  });
});
