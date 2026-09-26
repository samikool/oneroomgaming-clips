/**
 * Where a dragged queue entry ends up, as the `toIndex` for `moveTo`.
 *
 * `before` is the gap it was dropped into (0 = above the first entry,
 * length = below the last). Dropping below its own old position shifts the
 * target up one, because the entry leaves the list before it is reinserted.
 * Returns null when the drop would not move it.
 */
export function dropTarget(from: number, before: number): number | null {
  const to = before > from ? before - 1 : before;

  return to === from ? null : to;
}

/**
 * Which gap the pointer is over while dragging, given each row's box from
 * `getBoundingClientRect`. Above a row's midpoint is the gap before it; past
 * the last row's midpoint is the gap after the list. Taking the whole list at
 * once means the pointer can wander off the rows (into the space between
 * them, or above and below the list) and still land somewhere sensible.
 */
export function gapAtPointer(clientY: number, rows: { top: number; height: number }[]): number {
  const index = rows.findIndex((row) => clientY < row.top + row.height / 2);

  return index === -1 ? rows.length : index;
}
