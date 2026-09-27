/**
 * Share-at-timestamp: `/clips/<id>?t=<seconds>`. Pure, so the page, the
 * player and the share popover all agree on what a start time is.
 */

/**
 * Whole, non-negative seconds only — up to six digits, so eleven days. Anything
 * else (negative, fractional, exponent, padded, huge) is junk and ignored.
 */
export function parseStartSeconds(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) {
    return null;
  }

  return Number(raw);
}

/**
 * Keeps the start inside the clip: no later than a second before the end, so
 * the video lands on a frame rather than on "ended". An unknown duration
 * leaves it alone.
 */
export function clampStart(seconds: number, durationSec: number): number {
  if (!Number.isFinite(durationSec)) {
    return seconds;
  }

  return Math.max(0, Math.min(seconds, Math.floor(durationSec - 1)));
}

/** The link to share. A start of 0 or none is the plain clip link. */
export function shareUrl(origin: string, clipId: string, seconds: number | null): string {
  const base = `${origin}/clips/${clipId}`;
  return seconds === null || seconds <= 0 ? base : `${base}?t=${Math.floor(seconds)}`;
}

/** `0:42`, `1:02`, `1:02:03`. Whole seconds, rounded down. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * A comment form's `positionMs`: a whole, non-negative number of milliseconds
 * (at most ~11 days), or null. `FormData.get` gives a string or a File.
 */
export function parsePositionMs(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) {
    return null;
  }

  return Number(raw);
}
