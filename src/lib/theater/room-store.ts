import type { RoomState, ServerMessage } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE } from "@/lib/realtime/room-state";

export type ControlRequest = { user: string; at: number };

export type RoomView = {
  state: RoomState;
  inRoom: string[];
  requests: ControlRequest[];
};

export const INITIAL_ROOM_VIEW: RoomView = {
  state: INITIAL_ROOM_STATE,
  inRoom: [],
  requests: [],
};

/** Requests are not queued or persisted: an ignored one simply expires. */
export const REQUEST_TTL_MS = 30_000;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Folds a server message into the browser's view of the room.
 *
 * Returns the SAME object when nothing changed. Room snapshots arrive on every
 * join, leave and transport command, and most of them do not change what a
 * given component renders — a fresh object each time would re-render the
 * theater several times a second for nothing.
 */
export function reduceRoom(view: RoomView, message: ServerMessage, now: number): RoomView {
  if (message.t === "room") {
    // Ignore anything at or below the rev already applied. Without this a
    // delayed snapshot rewinds everyone's playhead after a seek — a bug that
    // only appears under real network conditions.
    if (message.state.rev <= view.state.rev) {
      return view;
    }

    // A request answered by a handoff should vanish from the host's screen
    // without them dismissing it.
    const requests = view.requests.filter((request) => request.user !== message.state.hostUserId);

    return {
      ...view,
      state: message.state,
      requests: requests.length === view.requests.length ? view.requests : requests,
    };
  }

  if (message.t === "presence") {
    return sameList(view.inRoom, message.inRoom) ? view : { ...view, inRoom: message.inRoom };
  }

  if (message.t === "room.controlRequested") {
    const kept = view.requests.filter(
      (request) => request.user !== message.user && now - request.at < REQUEST_TTL_MS,
    );

    return { ...view, requests: [...kept, { user: message.user, at: now }] };
  }

  return view;
}

export function dismissRequest(view: RoomView, user: string): RoomView {
  const requests = view.requests.filter((request) => request.user !== user);
  return requests.length === view.requests.length ? view : { ...view, requests };
}
