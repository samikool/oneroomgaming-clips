import { describe, expect, it } from "bun:test";
import type { RoomState } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE, positionNow } from "@/lib/realtime/room-state";

function playing(overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01ABC",
    clipTitle: "ace",
    clipDurationMs: 30_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 5_000,
    anchorServerTime: 1_000_000,
    rev: 3,
    ...overrides,
  };
}

describe("INITIAL_ROOM_STATE", () => {
  it("is an empty, hostless, paused room at rev 0", () => {
    expect(INITIAL_ROOM_STATE).toEqual({
      clipId: null,
      clipTitle: null,
      clipDurationMs: null,
      hostUserId: null,
      paused: true,
      positionMs: 0,
      anchorServerTime: 0,
      rev: 0,
    });
  });
});

describe("positionNow", () => {
  it("advances with the server clock while playing", () => {
    expect(positionNow(playing(), 1_002_000)).toBe(7_000);
  });

  it("is frozen while paused, whatever the clock says", () => {
    expect(positionNow(playing({ paused: true }), 1_999_999)).toBe(5_000);
  });

  it("is frozen when no clip is loaded", () => {
    expect(positionNow(INITIAL_ROOM_STATE, 5_000_000)).toBe(0);
  });

  it("never runs past the end of the clip", () => {
    // A room left playing overnight would otherwise compute a target hours
    // past the end, and every follower would hard-seek forever.
    expect(positionNow(playing(), 9_000_000)).toBe(30_000);
  });

  it("does not run backwards when a client's clock is behind the anchor", () => {
    expect(positionNow(playing(), 999_000)).toBe(5_000);
  });

  it("advances unbounded when the duration is unknown", () => {
    expect(positionNow(playing({ clipDurationMs: null }), 1_100_000)).toBe(105_000);
  });
});
