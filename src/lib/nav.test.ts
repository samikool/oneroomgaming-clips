import { describe, expect, it } from "bun:test";
import { isActiveNav } from "@/lib/nav";

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
