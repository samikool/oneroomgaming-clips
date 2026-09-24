import type { RoomState } from "@/lib/realtime/envelope";
import { positionNow } from "@/lib/realtime/room-state";

/** Below this, do nothing — correcting is more disruptive than the error. */
export const DRIFT_IGNORE_MS = 150;

/** Above this, the gap is too big to close smoothly. Hard seek. */
export const DRIFT_SEEK_MS = 750;

/** Once nudging, keep nudging until the drift is inside this. */
export const DRIFT_SETTLE_MS = 50;

/** How far the nudge moves playback rate from 1.0. */
export const NUDGE = 0.05;

/** How often a follower checks itself against the room. */
export const TICK_MS = 500;

export type Correction =
  | { kind: "hold" }
  | { kind: "rate"; rate: number }
  | { kind: "seek" };

/**
 * `driftMs` is target minus actual: positive means this player is BEHIND the
 * room and needs to speed up.
 *
 * `nudging` is what gives the middle band hysteresis. Without it, a nudge that
 * brings drift from 200ms to 149ms would stop and leave a permanent 149ms
 * error — under the dead band, but visible when two people are in the same
 * physical room.
 */
export function decideCorrection(driftMs: number, nudging: boolean): Correction {
  const magnitude = Math.abs(driftMs);

  if (magnitude > DRIFT_SEEK_MS) {
    return { kind: "seek" };
  }

  if (magnitude >= DRIFT_IGNORE_MS || (nudging && magnitude >= DRIFT_SETTLE_MS)) {
    return { kind: "rate", rate: driftMs > 0 ? 1 + NUDGE : 1 - NUDGE };
  }

  if (nudging) {
    return { kind: "rate", rate: 1 };
  }

  return { kind: "hold" };
}

/**
 * The subset of HTMLVideoElement this controller touches. Narrow on purpose:
 * it is what lets the drift logic be tested without a DOM.
 */
export type VideoLike = {
  currentTime: number;
  playbackRate: number;
  preservesPitch?: boolean;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
};

export type SyncController = {
  attach(video: VideoLike): void;
  applyRoomState(state: RoomState): void;
  detach(): void;
};

/**
 * Keeps a follower's video on the room's playhead.
 *
 * Hand-rolled rather than `timingsrc`: a TimingObject models velocity,
 * acceleration and timeline ranges for a general case we do not have, it does
 * not provide transport, and the thresholds above need direct tuning. The
 * interface is three methods precisely so swapping it later is one module.
 */
export function createSyncController(options: {
  clock: { now(localNow: number): number };
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onResync?: () => void;
  onAutoplayBlocked?: () => void;
}): SyncController {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearInterval(handle as never));

  let video: VideoLike | null = null;
  let state: RoomState | null = null;
  let nudging = false;
  /**
   * Whether this video has been put on the room's playhead at least once.
   *
   * The first positioning after attaching is ARRIVING, not falling behind: it
   * seeks from 0 to wherever the room is. Reporting that as a resync shows
   * everyone a "you fell behind" toast the instant they join.
   */
  let positioned = false;
  let handle: unknown;

  function tick(): void {
    if (video === null || state === null || state.clipId === null) {
      return;
    }

    const target = positionNow(state, options.clock.now(now())) / 1_000;

    if (state.paused) {
      if (!video.paused) {
        video.pause();
      }

      if (Math.abs(video.currentTime - target) * 1_000 > DRIFT_IGNORE_MS) {
        video.currentTime = target;
      }

      if (nudging) {
        video.playbackRate = 1;
        nudging = false;
      }

      positioned = true;
      return;
    }

    if (video.paused) {
      // Autoplay policy rejects this without a user gesture, which is exactly
      // why joining is a deliberate click. The caller shows "Tap to sync".
      void video.play().catch(() => options.onAutoplayBlocked?.());
    }

    const drift = (target - video.currentTime) * 1_000;
    const correction = decideCorrection(drift, nudging);

    if (correction.kind === "seek") {
      // The group never waits for the slowest viewer. A stalled follower
      // catches up by jumping forward, not by holding everyone else.
      video.currentTime = target;
      video.playbackRate = 1;
      nudging = false;

      if (positioned) {
        options.onResync?.();
      }

      positioned = true;
      return;
    }

    positioned = true;

    if (correction.kind === "rate") {
      video.playbackRate = correction.rate;
      nudging = correction.rate !== 1;
    }
  }

  return {
    attach(next) {
      video = next;
      // Explicit rather than trusting the browser default: it is the whole
      // reason a ±5% rate change is inaudible.
      next.preservesPitch = true;
      handle = setTimer(tick, TICK_MS);
    },
    applyRoomState(next) {
      state = next;
      // Act on the change now rather than waiting up to 500ms for the tick —
      // a pause that lands half a second late reads as a broken button.
      tick();
    },
    detach() {
      clearTimer(handle);
      handle = undefined;

      if (video) {
        video.playbackRate = 1;
      }

      video = null;
      state = null;
      nudging = false;
      positioned = false;
    },
  };
}
