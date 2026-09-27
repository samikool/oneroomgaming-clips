/** A step between two timeupdates longer than this is a seek, not playback. */
const MAX_STEP_S = 1.5;

/**
 * Played milliseconds so far, given the previous and current playhead in
 * seconds. Only small forward steps count, so seeking never makes a view.
 */
export function nextWatched(prevTime: number, currentTime: number, totalMs: number): number {
  const step = currentTime - prevTime;
  return step > 0 && step < MAX_STEP_S ? totalMs + step * 1000 : totalMs;
}
