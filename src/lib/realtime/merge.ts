import type { ClipSummary, ServerMessage } from "./envelope";

export type ClipMap = Record<string, ClipSummary>;

/**
 * Merges a live event into the grid's clip map.
 *
 * Returns the SAME object when nothing changed. A fresh object for a no-op
 * would re-render the whole grid on every duplicate event, and duplicates are
 * expected: the upload path announces a clip the page may already be showing.
 */
export function mergeClip(state: ClipMap, message: ServerMessage): ClipMap {
  if (message.t === "clip.added") {
    return state[message.clip.id] ? state : { ...state, [message.clip.id]: message.clip };
  }

  if (message.t === "clip.updated") {
    // An update for a clip this browser has never seen belongs to the next
    // page load, not to a card conjured out of a partial event.
    return state[message.clip.id] ? { ...state, [message.clip.id]: message.clip } : state;
  }

  return state;
}
