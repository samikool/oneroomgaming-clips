export const SWIPE_MIN_PX = 60;

/** A tab change only for a deliberate sideways swipe; a drifting scroll stays a scroll. */
export function swipeResult(dx: number, dy: number, index: number, count: number): number {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return index;
  return Math.min(count - 1, Math.max(0, index + (dx < 0 ? 1 : -1)));
}
