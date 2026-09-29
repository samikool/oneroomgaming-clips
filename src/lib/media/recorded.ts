const EARLIEST = Date.UTC(2000, 0, 1);
const DAY = 86_400_000;

/** Zeroed or garbage stamps (1904, 1970, the far future) are not recording times. */
export function plausibleRecordedAt(ms: number, now: number = Date.now()): boolean {
  return Number.isFinite(ms) && ms >= EARLIEST && ms <= now + DAY;
}
