import { describe, expect, it } from "bun:test";
import type { CommentRow } from "@/db/comments";
import { announceComment } from "@/lib/events/social";

const comment: CommentRow = {
  id: "01C",
  clipId: "01A",
  user: "sam",
  body: "gg",
  at: 1_000,
  deleted: false,
};

describe("announceComment", () => {
  it("does nothing when realtime is not configured", async () => {
    // An env without REALTIME_URL is a deliberate choice by the caller, and
    // publish() already returns false rather than throwing.
    await expect(announceComment(comment, {})).resolves.toBeUndefined();
  });

  it("posts the comment to /emit", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await announceComment(comment, {
        REALTIME_URL: "http://realtime:3001",
        EMIT_SECRET: "s",
      });
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://realtime:3001/emit");
    expect(seen[0].body).toEqual({ t: "comment.added", comment });
  });

  it("does not throw when realtime is unreachable", async () => {
    // A comment that saved must not 500 because the socket service is down.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    try {
      await expect(
        announceComment(comment, { REALTIME_URL: "http://down:3001", EMIT_SECRET: "s" }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
