import { describe, expect, it } from "bun:test";
import { isReaction, MAX_CHAT_LENGTH, normalizeChatText, REACTIONS } from "@/lib/realtime/chat";

describe("normalizeChatText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeChatText("  hello  ")).toBe("hello");
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(normalizeChatText("")).toBeNull();
    expect(normalizeChatText("   \n  ")).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    expect(normalizeChatText(42)).toBeNull();
    expect(normalizeChatText(null)).toBeNull();
    expect(normalizeChatText(["hi"])).toBeNull();
  });

  it("truncates rather than rejecting an over-long message", () => {
    // Rejecting would lose what someone typed. Truncating keeps it, and the
    // composer shows the limit anyway.
    const long = "x".repeat(MAX_CHAT_LENGTH + 50);
    expect(normalizeChatText(long)).toHaveLength(MAX_CHAT_LENGTH);
  });

  it("collapses newlines so one message cannot scroll the panel away", () => {
    expect(normalizeChatText("a\n\n\nb")).toBe("a b");
  });
});

describe("REACTIONS", () => {
  it("is a small fixed set", () => {
    expect(REACTIONS.length).toBeGreaterThan(0);
    expect(REACTIONS.length).toBeLessThanOrEqual(8);
  });

  it("accepts a member of the set", () => {
    expect(isReaction(REACTIONS[0])).toBe(true);
  });

  it("rejects anything outside it", () => {
    // Rendering an arbitrary user-supplied string as an "emoji" is an abuse
    // surface for no gain.
    expect(isReaction("<script>")).toBe(false);
    expect(isReaction("🦄")).toBe(false);
    expect(isReaction(7)).toBe(false);
    expect(isReaction(null)).toBe(false);
  });
});
