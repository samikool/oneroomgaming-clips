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
