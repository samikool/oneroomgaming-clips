import { describe, expect, it } from "bun:test";
import { isActiveNav, navIndex, tabsBetween } from "@/lib/nav";

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
