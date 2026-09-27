/** A gap longer than this since you were last seen starts a new visit. */
export const VISIT_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * The visit window after a request at `now`, or null when it doesn't move.
 * `previousVisitAt` is what "since you were last here" counts from.
 */
export function rollVisit(
  user: { lastSeenAt: number; visitStartedAt: number | null },
  now: number,
): { visitStartedAt: number; previousVisitAt: number | null } | null {
  if (user.visitStartedAt === null) return { visitStartedAt: now, previousVisitAt: null };
  if (now - user.lastSeenAt <= VISIT_GAP_MS) return null;
  return { visitStartedAt: now, previousVisitAt: user.visitStartedAt };
}
