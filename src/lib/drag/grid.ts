/**
 * `gapAtPointer` for a wrapping grid rather than a column: which gap, in
 * reading order, the pointer is over while dragging a tile. Each box is a
 * tile's `getBoundingClientRect`, in order.
 *
 * The pointer is before a tile when it is above that tile's row (above the
 * grid, or in the gutter between rows), or within its row and left of its
 * middle. Past every tile is the gap after the last. Pair it with
 * `dropTarget` from the queue for the resulting index.
 */
export function gapInGrid(
  clientX: number,
  clientY: number,
  tiles: { left: number; top: number; width: number; height: number }[],
): number {
  const index = tiles.findIndex(
    (tile) => clientY < tile.top || (clientY < tile.top + tile.height && clientX < tile.left + tile.width / 2),
  );

  return index === -1 ? tiles.length : index;
}
