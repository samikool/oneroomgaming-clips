/** 8-bit 4:2:0. The only thing H.264 decoders in browsers accept. */
const H264_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

/** AV1 Main profile covers 8- and 10-bit 4:2:0, and browsers decode both. */
const AV1_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p", "yuv420p10le"]);

/** VP9 profile 0. Higher profiles decode unevenly outside Chromium. */
const VP9_PIXEL_FORMATS = new Set(["yuv420p"]);

/**
 * Browser-decodable video codecs, each with the pixel formats it may use.
 * The video stream is copied into the stored mp4 untouched, so these are the
 * codecs a browser must decode inside mp4.
 *
 * Per-codec because the constraint genuinely differs: H.264 High 10 and High
 * 4:4:4 are not decodable in any browser, while 10-bit AV1 is ordinary. A
 * single shared pixel-format list rejected six real AV1 clips as
 * `needs_transcode`, which is a dead end while `transcode` is a stub.
 *
 * HEVC is absent: it needs platform support Chrome largely lacks. VP8 is
 * absent because mp4 cannot hold it.
 */
const PLAYABLE_VIDEO = new Map<string, Set<string>>([
  ["h264", H264_PIXEL_FORMATS],
  ["avc1", H264_PIXEL_FORMATS],
  ["av1", AV1_PIXEL_FORMATS],
  ["av01", AV1_PIXEL_FORMATS],
  ["vp9", VP9_PIXEL_FORMATS],
]);

/** Anything else is converted to AAC by the remux, which costs seconds. */
const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

/** Whether the video stream can be stored as it is. If not, the clip needs a transcode. */
export function isPlayableVideo(videoCodec: string | null, pixelFormat: string | null = null): boolean {
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
  return pixelFormat === null || allowedPixelFormats.has(pixelFormat.toLowerCase());
}

/** Whether the audio stream can be stored as it is. No audio track counts as playable. */
export function isPlayableAudio(audioCodec: string | null): boolean {
  return audioCodec === null || PLAYABLE_AUDIO.has(audioCodec.toLowerCase());
}
