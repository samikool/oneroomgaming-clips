import { describe, expect, it } from "bun:test";
import {
  isEphemeral,
  parseClientMessage,
  topicFor,
  type ServerMessage,
} from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC",
  title: "ace",
  status: "ready",
  thumbPath: "/media/thumbs/01ABC.jpg",
  durationMs: 4200,
  createdAt: 1_700_000_000_000,
};

describe("topicFor", () => {
  it("routes clip lifecycle to the grid topic", () => {
    expect(topicFor({ t: "clip.added", clip })).toBe("grid");
    expect(topicFor({ t: "clip.updated", clip })).toBe("grid");
  });

  it("routes upload progress to the grid topic", () => {
    expect(topicFor({ t: "upload.progress", uploadId: "u1", pct: 40, user: "sam" })).toBe("grid");
  });

  it("routes presence to the grid topic", () => {
    expect(topicFor({ t: "presence", online: ["sam"] })).toBe("grid");
  });

  it("routes per-connection messages to the user topic", () => {
    expect(topicFor({ t: "hello", username: "sam", serverTime: 1 })).toBe("user");
    expect(topicFor({ t: "time.sync", t0: 1, t1: 2 })).toBe("user");
  });
});

describe("isEphemeral", () => {
  it("treats progress and presence as droppable", () => {
    expect(isEphemeral({ t: "upload.progress", uploadId: "u1", pct: 1, user: "sam" })).toBe(true);
    expect(isEphemeral({ t: "presence", online: [] })).toBe(true);
  });

  it("never treats clip lifecycle as droppable", () => {
    expect(isEphemeral({ t: "clip.added", clip })).toBe(false);
    expect(isEphemeral({ t: "clip.updated", clip })).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("accepts a subscribe message", () => {
    expect(parseClientMessage('{"t":"sub","topics":["grid"]}')).toEqual({
      t: "sub",
      topics: ["grid"],
    });
  });

  it("accepts a time.sync message", () => {
    expect(parseClientMessage('{"t":"time.sync","t0":123}')).toEqual({ t: "time.sync", t0: 123 });
  });

  it("rejects malformed JSON", () => {
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("rejects an unknown message type", () => {
    expect(parseClientMessage('{"t":"room.control","action":"play"}')).toBeNull();
  });

  it("rejects a subscribe naming an unknown topic", () => {
    expect(parseClientMessage('{"t":"sub","topics":["grid","hacker"]}')).toBeNull();
  });

  it("rejects a subscribe whose topics is not an array", () => {
    expect(parseClientMessage('{"t":"sub","topics":"grid"}')).toBeNull();
  });
});

// The `t` values above are checked against the union at compile time; this
// keeps the unused-import warning away while documenting the intent.
export type _EnvelopeUnderTest = ServerMessage;
