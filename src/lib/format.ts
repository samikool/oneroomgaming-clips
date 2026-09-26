export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return "—";
  }

  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole bytes read oddly with a decimal; everything above benefits from one.
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

const AGO_UNITS: [ms: number, suffix: string][] = [
  [365 * 86_400_000, "y"],
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];

/** "5m ago", in the largest whole unit. A timestamp from the future is "just now". */
export function formatAgo(at: number, now: number = Date.now()): string {
  const elapsed = now - at;

  for (const [size, suffix] of AGO_UNITS) {
    if (elapsed >= size) {
      return `${Math.floor(elapsed / size)}${suffix} ago`;
    }
  }

  return "just now";
}
