import { describe, expect, it } from "bun:test";
import type { RoomState } from "@/lib/realtime/envelope";
import {
  createSyncController,
  decideCorrection,
  TICK_MS,
  type VideoLike,
} from "@/lib/theater/sync-controller";

describe("decideCorrection", () => {
  it("holds inside the dead band — correcting here is worse than the error", () => {
    expect(decideCorrection(0, false)).toEqual({ kind: "hold" });
    expect(decideCorrection(149, false)).toEqual({ kind: "hold" });
    expect(decideCorrection(-149, false)).toEqual({ kind: "hold" });
  });

  it("nudges faster when behind", () => {
    expect(decideCorrection(200, false)).toEqual({ kind: "rate", rate: 1.05 });
  });

  it("nudges slower when ahead", () => {
    expect(decideCorrection(-200, false)).toEqual({ kind: "rate", rate: 0.95 });
  });

  it("hard-seeks past the outer band", () => {
    expect(decideCorrection(751, false)).toEqual({ kind: "seek" });
    expect(decideCorrection(-751, false)).toEqual({ kind: "seek" });
  });

  it("keeps nudging below 150 once it has started, down to the settle band", () => {
    // Hysteresis. Stopping at 149 would leave a permanent 149ms error.
    expect(decideCorrection(100, true)).toEqual({ kind: "rate", rate: 1.05 });
    expect(decideCorrection(-100, true)).toEqual({ kind: "rate", rate: 0.95 });
  });

  it("returns to normal speed once it has settled", () => {
    expect(decideCorrection(49, true)).toEqual({ kind: "rate", rate: 1 });
    expect(decideCorrection(-49, true)).toEqual({ kind: "rate", rate: 1 });
  });

  it("switches direction if a nudge overshoots", () => {
    expect(decideCorrection(-300, true)).toEqual({ kind: "rate", rate: 0.95 });
  });
});

function fakeVideo() {
  const calls: string[] = [];
  const video: VideoLike = {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    play() {
      video.paused = false;
      calls.push("play");
      return Promise.resolve();
    },
    pause() {
      video.paused = true;
      calls.push("pause");
    },
  };

  return { video, calls };
}

function playingState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01A",
    clipTitle: "ace",
    clipDurationMs: 600_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 10_000,
    anchorServerTime: 1_000_000,
    rev: 1,
    ...overrides,
  };
}

function controllerHarness() {
  let localNow = 1_000_000;
  let scheduled: (() => void) | null = null;
  const resyncs: number[] = [];
  const blocked: number[] = [];
  const { video, calls } = fakeVideo();

  const controller = createSyncController({
    // An identity clock: the harness drives server time directly.
    clock: { now: (n: number) => n },
    now: () => localNow,
    setTimer: (fn: () => void) => {
      scheduled = fn;
      return 1;
    },
    clearTimer: () => {
      scheduled = null;
    },
    onResync: () => resyncs.push(localNow),
    onAutoplayBlocked: () => blocked.push(localNow),
  });

  return {
    controller,
    video,
    calls,
    resyncs,
    blocked,
    advance: (ms: number) => (localNow += ms),
    tick: () => scheduled?.(),
  };
}

describe("createSyncController", () => {
  it("sets preservesPitch on attach — it is why a 5% nudge is inaudible", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);

    expect(h.video.preservesPitch).toBe(true);
    h.controller.detach();
  });

  it("does nothing before a room state arrives", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.tick();

    expect(h.calls).toEqual([]);
    h.controller.detach();
  });

  it("starts playing and seeks to the target when the room is playing", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.advance(5_000);
    h.tick();

    expect(h.calls).toContain("play");
    // 10s position plus 5s elapsed, against a video at 0 — far outside the
    // outer band, so a hard seek.
    expect(h.video.currentTime).toBeCloseTo(15, 2);
    h.controller.detach();
  });

  it("pauses and parks the playhead when the room is paused", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.video.currentTime = 40;
    h.video.paused = false;
    h.controller.applyRoomState(playingState({ paused: true, positionMs: 8_000 }));

    expect(h.calls).toContain("pause");
    expect(h.video.currentTime).toBeCloseTo(8, 2);
    h.controller.detach();
  });

  it("nudges rather than seeks for a small drift", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();

    expect(h.video.playbackRate).toBe(1.05);
    expect(h.video.currentTime).toBeCloseTo(10, 2);
    h.controller.detach();
  });

  it("reports a resync when it has to hard-seek", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(5_000);
    h.tick();

    expect(h.resyncs).toHaveLength(1);
    h.controller.detach();
  });

  it("does not report a resync for a nudge", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();

    expect(h.resyncs).toEqual([]);
    h.controller.detach();
  });

  it("reports a blocked autoplay instead of throwing", async () => {
    const h = controllerHarness();
    h.video.play = () => Promise.reject(new Error("NotAllowedError"));
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    await Bun.sleep(1);

    expect(h.blocked).toHaveLength(1);
    h.controller.detach();
  });

  it("restores normal playback rate on detach", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();
    h.controller.detach();

    expect(h.video.playbackRate).toBe(1);
  });

  it("stops ticking after detach", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.controller.detach();
    const before = h.calls.length;
    h.tick();

    expect(h.calls).toHaveLength(before);
  });

  it("acts on a new room state immediately rather than waiting for the tick", () => {
    // A pause that lands half a second late reads as a broken button.
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.paused = false;
    h.calls.length = 0;
    h.controller.applyRoomState(playingState({ paused: true, positionMs: 3_000, rev: 2 }));

    expect(h.calls).toContain("pause");
    h.controller.detach();
  });

  it("ticks on the interval the spec names", () => {
    expect(TICK_MS).toBe(500);
  });
});

describe("createSyncController — arriving is not resyncing", () => {
  it("does not report a resync for the seek that puts you on the playhead", () => {
    // Joining seeks from 0 to wherever the room is. Calling that a resync
    // shows a "you fell behind" toast to everyone the instant they join.
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());

    expect(h.video.currentTime).toBeCloseTo(10, 2);
    expect(h.resyncs).toEqual([]);
    h.controller.detach();
  });

  it("still reports a resync for a later fall-behind", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.paused = false;
    h.advance(5_000);
    h.tick();

    expect(h.resyncs).toHaveLength(1);
    h.controller.detach();
  });
});
