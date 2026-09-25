/** 8-bit 4:2:0. The only thing H.264 decoders in browsers accept. */
const H264_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

/** AV1 Main profile covers 8- and 10-bit 4:2:0, and browsers decode both. */
const AV1_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p", "yuv420p10le"]);

/**
 * Browser-decodable video codecs, each with the pixel formats it may use.
 *
 * Per-codec because the constraint genuinely differs: H.264 High 10 and High
 * 4:4:4 are not decodable in any browser, while 10-bit AV1 is ordinary. A
 * single shared pixel-format list rejected six real AV1 clips as
 * `needs_transcode`, which is a dead end while `transcode` is a stub.
 *
 * HEVC and VP8/VP9 are deliberately absent: HEVC needs platform support Chrome
 * largely lacks, and VP9-in-MP4 is patchy outside Chromium.
 */
const PLAYABLE_VIDEO = new Map<string, Set<string>>([
  ["h264", H264_PIXEL_FORMATS],
  ["avc1", H264_PIXEL_FORMATS],
  ["av1", AV1_PIXEL_FORMATS],
  ["av01", AV1_PIXEL_FORMATS],
]);

const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

export function isBrowserPlayable(
  videoCodec: string | null,
  audioCodec: string | null,
  pixelFormat: string | null = null,
): boolean {
  if (videoCodec === null) {
    return false;
  }

  const allowedPixelFormats = PLAYABLE_VIDEO.get(videoCodec.toLowerCase());

  if (!allowedPixelFormats) {
    return false;
  }

  // Permissive when unknown: `transcode` is registered but stubbed, so
  // needs_transcode is a dead end, and stranding a file there on absent
  // evidence is worse than letting it through.
  if (pixelFormat !== null && !allowedPixelFormats.has(pixelFormat.toLowerCase())) {
    return false;
  }

  if (audioCodec === null) {
    return true;
  }

  return PLAYABLE_AUDIO.has(audioCodec.toLowerCase());
}
