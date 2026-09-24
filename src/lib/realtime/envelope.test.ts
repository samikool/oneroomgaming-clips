import { describe, expect, it } from "bun:test";
import {
  isEphemeral,
  parseClientMessage,
  topicsFor,
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

describe("topicsFor", () => {
  it("routes clip lifecycle to the grid topic", () => {
    expect(topicsFor({ t: "clip.added", clip })).toEqual(["grid"]);
    expect(topicsFor({ t: "clip.updated", clip })).toEqual(["grid"]);
  });

  it("routes upload progress to the grid topic", () => {
    expect(topicsFor({ t: "upload.progress", uploadId: "u1", pct: 40, user: "sam" })).toEqual(["grid"]);
  });

  it("routes presence to both grid and room", () => {
    // The grid shows who is on the site and the theater shows who is in the
    // room; both facts travel in this one message.
    expect(topicsFor({ t: "presence", online: ["sam"], inRoom: [] })).toEqual(["grid", "room"]);
  });

  it("routes per-connection messages to the user topic", () => {
    expect(topicsFor({ t: "hello", username: "sam", serverTime: 1 })).toEqual(["user"]);
    expect(topicsFor({ t: "time.sync", t0: 1, t1: 2 })).toEqual(["user"]);
  });
});

describe("isEphemeral", () => {
  it("treats progress and presence as droppable", () => {
    expect(isEphemeral({ t: "upload.progress", uploadId: "u1", pct: 1, user: "sam" })).toBe(true);
    expect(isEphemeral({ t: "presence", online: [], inRoom: [] })).toBe(true);
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
    // `room.control` stood here while milestone 5 was unimplemented. Chat and
    // reactions are the next names reserved-but-not-built.
    expect(parseClientMessage('{"t":"chat.send","text":"hi"}')).toBeNull();
    expect(parseClientMessage('{"t":"reaction.send","emoji":"🔥"}')).toBeNull();
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

describe("parseClientMessage — room commands", () => {
  it("accepts a bare room.join", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.join" }))).toEqual({ t: "room.join" });
  });

  it("accepts room.leave and room.claimHost and room.requestControl", () => {
    for (const t of ["room.leave", "room.claimHost", "room.requestControl"]) {
      expect(parseClientMessage(JSON.stringify({ t }))).toEqual({ t } as never);
    }
  });

  it("accepts room.giveControl with a userId", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: "sam" }))).toEqual({
      t: "room.giveControl",
      userId: "sam",
    });
  });

  it("rejects room.giveControl without a usable userId", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: 7 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: "" }))).toBeNull();
  });

  it("accepts a seek carrying a position", () => {
    expect(
      parseClientMessage(JSON.stringify({ t: "room.control", action: "seek", positionMs: 4200 })),
    ).toEqual({ t: "room.control", action: "seek", positionMs: 4200 });
  });

  it("rejects a seek with no position", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "seek" }))).toBeNull();
  });

  it("rejects a negative seek", () => {
    // realtime treats the position as opaque; a negative one would make every
    // follower hard-seek to a time that does not exist.
    expect(
      parseClientMessage(JSON.stringify({ t: "room.control", action: "seek", positionMs: -1 })),
    ).toBeNull();
  });

  it("accepts setClip carrying the metadata realtime cannot look up", () => {
    const raw = JSON.stringify({
      t: "room.control",
      action: "setClip",
      clipId: "01ABC",
      title: "ace",
      durationMs: 9000,
    });

    expect(parseClientMessage(raw)).toEqual({
      t: "room.control",
      action: "setClip",
      clipId: "01ABC",
      title: "ace",
      durationMs: 9000,
    });
  });

  it("rejects setClip without a clipId", () => {
    expect(
      parseClientMessage(JSON.stringify({ t: "room.control", action: "setClip", title: "ace" })),
    ).toBeNull();
  });

  it("rejects an unknown action", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "explode" }))).toBeNull();
  });

  it("accepts play and pause with no position", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "play" }))).toEqual({
      t: "room.control",
      action: "play",
    });
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "pause" }))).toEqual({
      t: "room.control",
      action: "pause",
    });
  });
});

describe("topicsFor — room messages", () => {
  const state = {
    clipId: null,
    clipTitle: null,
    clipDurationMs: null,
    hostUserId: null,
    paused: true,
    positionMs: 0,
    anchorServerTime: 0,
    rev: 0,
  };

  it("routes a room snapshot to the room topic", () => {
    expect(topicsFor({ t: "room", state })).toEqual(["room"]);
  });

  it("routes a control request to the room topic", () => {
    expect(topicsFor({ t: "room.controlRequested", user: "sam" })).toEqual(["room"]);
  });
});
