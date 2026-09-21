export type LastSeenReader = () => string | null;

/**
 * Safely reads the last-seen version. Any error (e.g. localStorage being
 * unavailable in private-browsing mode) is swallowed and treated as "no
 * value seen yet" rather than propagating.
 */
export function readLastSeenVersion(readLastSeen: LastSeenReader): string | null {
  try {
    return readLastSeen();
  } catch {
    return null;
  }
}

export interface ShouldShowChangelogParams {
  /** The newest known changelog version. */
  latest: string;
  /**
   * The version last seen by this browser, or null/undefined if none is
   * recorded yet (e.g. a first visit).
   */
  lastSeen?: string | null;
  /**
   * Alternative to `lastSeen`: a function that reads the stored value. Any
   * error it throws is caught and treated as no stored value.
   */
  readLastSeen?: LastSeenReader;
}

/**
 * Pure decision of whether the changelog modal should be shown.
 *
 * Rules:
 * - No stored value (first visit) -> never show.
 * - Stored value equal to latest -> don't show.
 * - Stored value different from latest (including a "rollback" where the
 *   stored value is newer than latest) -> show. This is a plain inequality,
 *   not a semver comparison.
 */
export function shouldShowChangelog(params: ShouldShowChangelogParams): boolean {
  const lastSeen = params.readLastSeen
    ? readLastSeenVersion(params.readLastSeen)
    : (params.lastSeen ?? null);

  if (lastSeen === null) {
    return false;
  }

  return lastSeen !== params.latest;
}
