import type { RoomState } from "./envelope";

export const INITIAL_ROOM_STATE: RoomState = {
  clipId: null,
  clipTitle: null,
  clipDurationMs: null,
  hostUserId: null,
  paused: true,
  positionMs: 0,
  anchorServerTime: 0,
  queue: [],
  rev: 0,
};

/**
 * The playhead as of `serverNow`, in server time.
 *
 * Both processes use this: `realtime` to freeze the position when the room
 * pauses or loses its host, and the browser to compute the target it corrects
 * drift against. Keeping one implementation is what stops the two from
 * disagreeing about where "now" is.
 */
export function positionNow(state: RoomState, serverNow: number): number {
  if (state.paused || state.clipId === null) {
    return state.positionMs;
  }

  // A client whose offset estimate lands behind the anchor must not rewind the
  // room; clamping at zero elapsed is cheaper than trusting the sample.
  const elapsed = Math.max(0, serverNow - state.anchorServerTime);
  const raw = state.positionMs + elapsed;

  return state.clipDurationMs === null ? raw : Math.min(raw, state.clipDurationMs);
}
