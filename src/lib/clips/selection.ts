/**
 * Selection is a plain `Set` of clip ids, transformed by pure functions so the
 * grid's trickiest state is testable without rendering anything.
 */

/** Adds or removes one id, never mutating the set it was given. */
export function toggleSelection(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);

  if (!next.delete(id)) {
    next.add(id);
  }

  return next;
}

/**
 * Drops selected ids that are no longer in the grid.
 *
 * Without this, a `clip.removed` from another admin leaves an id selected that
 * has no card, and the action bar reports a count the page cannot show.
 *
 * Returns the SAME set when nothing was pruned, so this can be called on every
 * render without forcing one.
 */
export function pruneSelection(selected: Set<string>, present: string[]): Set<string> {
  if (selected.size === 0) {
    return selected;
  }

  const alive = new Set(present);
  const next = new Set([...selected].filter((id) => alive.has(id)));

  return next.size === selected.size ? selected : next;
}
