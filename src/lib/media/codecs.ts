const PLAYABLE_VIDEO = new Set(["h264", "avc1"]);
const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

export function isBrowserPlayable(
  videoCodec: string | null,
  audioCodec: string | null,
): boolean {
  if (videoCodec === null || !PLAYABLE_VIDEO.has(videoCodec.toLowerCase())) {
    return false;
  }

  if (audioCodec === null) {
    return true;
  }

  return PLAYABLE_AUDIO.has(audioCodec.toLowerCase());
}
