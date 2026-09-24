import { describe, expect, it } from "bun:test";
import type { RoomState, ServerMessage } from "@/lib/realtime/envelope";
import {
  dismissRequest,
  INITIAL_ROOM_VIEW,
  reduceRoom,
  REQUEST_TTL_MS,
  type RoomView,
} from "@/lib/theater/room-store";

function stateAt(rev: number, overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01A",
    clipTitle: "ace",
    clipDurationMs: 30_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 1_000,
    anchorServerTime: 500,
    rev,
    ...overrides,
  };
}

function snapshot(state: RoomState): ServerMessage {
  return { t: "room", state };
}

describe("reduceRoom — rev guard", () => {
  it("applies a newer snapshot", () => {
    expect(reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(1)), 0).state.rev).toBe(1);
  });

  it("ignores a snapshot that arrived out of order", () => {
    // This is the bug that only shows up under real network conditions: a
    // delayed message rewinding everyone's playhead after a seek.
    const applied = reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(5)), 0);
    const stale = reduceRoom(applied, snapshot(stateAt(3, { positionMs: 99_000 })), 0);

    expect(stale).toBe(applied);
  });

  it("ignores a repeat of the rev it already has", () => {
    const applied = reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(5)), 0);
    expect(reduceRoom(applied, snapshot(stateAt(5)), 0)).toBe(applied);
  });
});

describe("reduceRoom — presence", () => {
  it("records who is in the room", () => {
    const next = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "presence", online: ["sam", "dave", "kai"], inRoom: ["sam", "dave"] },
      0,
    );

    expect(next.inRoom).toEqual(["sam", "dave"]);
  });

  it("returns the same object when the room membership has not changed", () => {
    const view = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "presence", online: ["sam"], inRoom: ["sam"] },
      0,
    );
    const again = reduceRoom(view, { t: "presence", online: ["sam", "dave"], inRoom: ["sam"] }, 0);

    expect(again).toBe(view);
  });
});

describe("reduceRoom — control requests", () => {
  it("records a request with the time it arrived", () => {
    const next = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    expect(next.requests).toEqual([{ user: "dave", at: 1_000 }]);
  });

  it("refreshes rather than duplicating a repeat request", () => {
    const first = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    const second = reduceRoom(first, { t: "room.controlRequested", user: "dave" }, 2_000);

    expect(second.requests).toEqual([{ user: "dave", at: 2_000 }]);
  });

  it("expires a request that the host ignored", () => {
    const first = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    const later = reduceRoom(
      first,
      { t: "room.controlRequested", user: "kai" },
      1_000 + REQUEST_TTL_MS + 1,
    );

    expect(later.requests.map((request) => request.user)).toEqual(["kai"]);
  });

  it("clears a user's request once they become host", () => {
    const withRequest = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "room.controlRequested", user: "dave" },
      1_000,
    );
    const granted = reduceRoom(withRequest, snapshot(stateAt(2, { hostUserId: "dave" })), 1_100);

    expect(granted.requests).toEqual([]);
  });

  it("leaves other people's requests alone on a handoff", () => {
    let view = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    view = reduceRoom(view, { t: "room.controlRequested", user: "kai" }, 1_000);
    const granted = reduceRoom(view, snapshot(stateAt(2, { hostUserId: "dave" })), 1_100);

    expect(granted.requests.map((request) => request.user)).toEqual(["kai"]);
  });
});

describe("dismissRequest", () => {
  it("drops one request and leaves the rest", () => {
    let view: RoomView = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "room.controlRequested", user: "dave" },
      0,
    );
    view = reduceRoom(view, { t: "room.controlRequested", user: "kai" }, 0);

    expect(dismissRequest(view, "dave").requests.map((r) => r.user)).toEqual(["kai"]);
  });

  it("returns the same object when there was nothing to dismiss", () => {
    expect(dismissRequest(INITIAL_ROOM_VIEW, "nobody")).toBe(INITIAL_ROOM_VIEW);
  });
});

describe("reduceRoom — everything else", () => {
  it("passes an unrelated message through untouched", () => {
    const clip = {
      id: "01B",
      title: "x",
      status: "ready",
      thumbPath: null,
      durationMs: null,
      createdAt: 1,
    };

    expect(reduceRoom(INITIAL_ROOM_VIEW, { t: "clip.added", clip }, 0)).toBe(INITIAL_ROOM_VIEW);
  });
});
