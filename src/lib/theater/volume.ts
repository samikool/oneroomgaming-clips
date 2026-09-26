export type Volume = { level: number; muted: boolean };

export const DEFAULT_VOLUME: Volume = { level: 1, muted: false };

/**
 * A saved volume, read defensively: storage is per browser and anything in it
 * may be stale, hand-edited or from an older shape. The level is kept apart
 * from mute so unmuting returns to where you were.
 */
export function parseStoredVolume(raw: string | null): Volume {
  if (raw === null) {
    return DEFAULT_VOLUME;
  }

  try {
    const value = JSON.parse(raw) as Partial<Volume>;

    if (typeof value.level !== "number" || !Number.isFinite(value.level)) {
      return DEFAULT_VOLUME;
    }

    return { level: Math.min(1, Math.max(0, value.level)), muted: value.muted === true };
  } catch {
    return DEFAULT_VOLUME;
  }
}
