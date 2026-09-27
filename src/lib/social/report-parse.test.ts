import { describe, expect, it } from "bun:test";
import { parseReportedEvent } from "./report-parse";

describe("parseReportedEvent", () => {
  it("accepts each event kind", () => {
    expect(parseReportedEvent({ kind: "theater.play", user: "sam", clipId: "C", at: 1 })).toEqual({
      kind: "theater.play",
      user: "sam",
      clipId: "C",
      at: 1,
    });
    expect(parseReportedEvent({ kind: "theater.reaction", user: "sam", clipId: null, emoji: "🔥", at: 1 })).not.toBeNull();
    expect(parseReportedEvent({ kind: "theater.chat", user: "sam", clipId: "C", body: "@kobe", at: 1 })).not.toBeNull();
  });

  it("drops unknown extra fields", () => {
    expect(parseReportedEvent({ kind: "theater.play", user: "sam", clipId: "C", at: 1, extra: "x" })).not.toHaveProperty("extra");
  });

  it("rejects junk", () => {
    for (const bad of [
      null,
      [],
      "x",
      { kind: "nope" },
      { kind: "theater.play", user: "", clipId: "C", at: 1 },
      { kind: "theater.play", user: "s", clipId: null, at: 1 },
      { kind: "theater.play", user: "s", clipId: "C", at: Number.NaN },
      { kind: "theater.chat", user: "s", clipId: "C", body: 5, at: 1 },
      { kind: "theater.chat", user: "s", clipId: "C", body: "x".repeat(501), at: 1 },
      { kind: "theater.reaction", user: "s", clipId: "C", at: 1 },
    ]) {
      expect(parseReportedEvent(bad)).toBeNull();
    }
  });
});
