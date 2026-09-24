const PLAYABLE_VIDEO = new Set(["h264", "avc1"]);
const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

/**
 * The only chroma subsamplings browsers decode for H.264.
 *
 * A 4:4:4 or 10-bit file probes as plain `h264` and plays fine in VLC, then
 * shows a black player in every browser. Checking the codec name alone is not
 * enough, which is how three unplayable test clips sat in the library marked
 * `ready`.
 */
const PLAYABLE_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

export function isBrowserPlayable(
  videoCodec: string | null,
  audioCodec: string | null,
  pixelFormat: string | null = null,
): boolean {
  if (videoCodec === null || !PLAYABLE_VIDEO.has(videoCodec.toLowerCase())) {
    return false;
  }

  // Permissive when unknown: `transcode` is registered but stubbed, so
  // needs_transcode is a dead end, and stranding a file there on absent
  // evidence is worse than letting it through.
  if (pixelFormat !== null && !PLAYABLE_PIXEL_FORMATS.has(pixelFormat.toLowerCase())) {
    return false;
  }

  if (audioCodec === null) {
    return true;
  }

  return PLAYABLE_AUDIO.has(audioCodec.toLowerCase());
}
