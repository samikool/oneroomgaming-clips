import type { ActivityType } from "@/db/schema";

/** One place to tune after real use. */
export const WEIGHTS: Record<"like" | ActivityType, number> = {
  like: 4,
  comment: 3,
  theater_play: 2,
  view: 1,
  reaction: 1,
};

const DAY = 24 * 60 * 60 * 1000;
export const HALF_LIFE_MS = 2 * DAY;
export const WINDOW_MS = 7 * DAY;
/** A person's views of one clip count at most once per this long. */
export const VIEW_DEDUPE_MS = 30 * 60 * 1000;
/** Actual playback before a view is reported. */
export const VIEW_MIN_MS = 3000;

/** `weight × 0.5^(age / HALF_LIFE)`, and nothing once outside the window. */
export function decayedWeight(weight: number, ageMs: number): number {
  if (ageMs > WINDOW_MS) return 0;
  return weight * 0.5 ** (Math.max(0, ageMs) / HALF_LIFE_MS);
}
