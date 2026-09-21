import { describe, expect, it } from "bun:test";
import { isAuthorizedEmit } from "@/realtime/emit-auth";

describe("isAuthorizedEmit", () => {
  it("accepts a matching secret", () => {
    expect(isAuthorizedEmit("correct-horse", "correct-horse")).toBe(true);
  });

  it("rejects a mismatched secret", () => {
    expect(isAuthorizedEmit("wrong", "correct-horse")).toBe(false);
  });

  it("rejects a missing secret on the request", () => {
    expect(isAuthorizedEmit(undefined, "correct-horse")).toBe(false);
  });

  it("rejects when the server has no secret configured", () => {
    expect(isAuthorizedEmit("anything", undefined)).toBe(false);
  });

  it("rejects when the server secret is empty", () => {
    expect(isAuthorizedEmit("", "")).toBe(false);
  });

  it("rejects an array-valued header", () => {
    expect(isAuthorizedEmit(["correct-horse", "extra"], "correct-horse")).toBe(false);
  });

  it("rejects a secret that is a prefix of the expected value", () => {
    expect(isAuthorizedEmit("correct", "correct-horse")).toBe(false);
  });
});
