import { describe, expect, it } from "bun:test";
import { glideFrames, glideStops, isActiveNav, navIndex, tabsBetween, underlineBox } from "@/lib/nav";

describe("isActiveNav", () => {
  it("matches a page to its own link", () => {
    expect(isActiveNav("/theater", "/theater")).toBe(true);
  });

  it("matches sub-paths", () => {
    expect(isActiveNav("/changelog/0.1.1", "/changelog")).toBe(true);
  });

  it("does not match a longer name that shares the prefix", () => {
    expect(isActiveNav("/theaterx", "/theater")).toBe(false);
  });

  it("matches home only on home or a clip", () => {
    expect(isActiveNav("/", "/")).toBe(true);
    expect(isActiveNav("/clips/01ABC", "/")).toBe(true);
    expect(isActiveNav("/upload", "/")).toBe(false);
  });
});

describe("navIndex", () => {
  it("places each page at its header tab's position", () => {
    expect(navIndex("/")).toBe(0);
    expect(navIndex("/clips/01ABC")).toBe(0);
    expect(navIndex("/theater")).toBe(1);
    expect(navIndex("/upload")).toBe(2);
    expect(navIndex("/changelog")).toBe(3);
  });

  it("has no position for a page outside the header", () => {
    expect(navIndex("/somewhere-else")).toBeNull();
  });
});

describe("tabsBetween", () => {
  it("lists the tabs passed on the way, in travel order", () => {
    expect(tabsBetween(3, 0)).toEqual(["Upload", "Theater"]);
    expect(tabsBetween(0, 3)).toEqual(["Theater", "Upload"]);
  });

  it("is empty for neighbouring tabs", () => {
    expect(tabsBetween(1, 2)).toEqual([]);
    expect(tabsBetween(2, 1)).toEqual([]);
  });
});

describe("underlineBox", () => {
  it("sits a 2px bar along the bottom edge of the link", () => {
    expect(underlineBox({ offsetLeft: 120, offsetTop: 40, offsetWidth: 64, offsetHeight: 40 })).toEqual({
      x: 120,
      y: 78,
      width: 64,
    });
  });
});

describe("glideStops", () => {
  it("stops under every tab on the way, ending on the target", () => {
    expect(glideStops(0, 3)).toEqual([1, 2, 3]);
    expect(glideStops(3, 1)).toEqual([2, 1]);
  });

  it("is just the target for a neighbour", () => {
    expect(glideStops(2, 1)).toEqual([1]);
  });
});

describe("glideFrames", () => {
  const settle = "ease-out";
  const at = (x: number) => ({ x, y: 38, width: 50 });

  it("spaces the stops evenly, linear until the last stretch settles", () => {
    expect(glideFrames([at(0), at(60), at(120), at(180)], settle)).toEqual([
      { transform: "translate(0px, 38px)", width: "50px", offset: 0, easing: "linear" },
      { transform: "translate(60px, 38px)", width: "50px", offset: 1 / 3, easing: "linear" },
      { transform: "translate(120px, 38px)", width: "50px", offset: 2 / 3, easing: settle },
      { transform: "translate(180px, 38px)", width: "50px", offset: 1 },
    ]);
  });

  it("settles the whole way for a single hop", () => {
    expect(glideFrames([at(0), at(60)], settle)).toEqual([
      { transform: "translate(0px, 38px)", width: "50px", offset: 0, easing: settle },
      { transform: "translate(60px, 38px)", width: "50px", offset: 1 },
    ]);
  });
});
