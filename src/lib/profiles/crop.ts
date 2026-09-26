/**
 * The maths behind the picture cropper. Offsets are in source-image pixels,
 * relative to the centred square.
 */

function squareSize(imageW: number, imageH: number, zoom: number): number {
  return Math.min(imageW, imageH) / Math.max(1, zoom);
}

/** The source square to draw, given the image size, a zoom ≥ 1 and a pan. */
export function coverCrop(imageW: number, imageH: number, zoom: number, offsetX: number, offsetY: number) {
  const sSize = squareSize(imageW, imageH, zoom);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const sx = clamp((imageW - sSize) / 2 + offsetX, imageW - sSize);
  const sy = clamp((imageH - sSize) / 2 + offsetY, imageH - sSize);
  return { sx: Math.round(sx), sy: Math.round(sy), sSize: Math.round(sSize) };
}

/**
 * A pan pulled back inside the image. Without it a drag past the edge keeps
 * accumulating, and dragging back appears stuck until it is undone.
 */
export function clampOffset(imageW: number, imageH: number, zoom: number, offsetX: number, offsetY: number) {
  const sSize = squareSize(imageW, imageH, zoom);
  const spareX = (imageW - sSize) / 2;
  const spareY = (imageH - sSize) / 2;
  const clamp = (value: number, spare: number) => Math.min(Math.max(value, -spare), spare);
  // `+ 0` turns a -0 into 0, which matters to anyone comparing with toEqual.
  return { x: clamp(offsetX, spareX) + 0, y: clamp(offsetY, spareY) + 0 };
}
