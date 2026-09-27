import type { QueueClip } from "@/lib/realtime/envelope";

/**
 * What a collection sends to the theater queue: its ready clips, in
 * collection order. Anything still processing or failed can't be played in
 * sync, so it is skipped and counted for the sender's notice. The server
 * never sees the skipped ones.
 */
export function buildLoadList(detail: {
  clips: { id: string; title: string; status: string; durationMs: number | null }[];
}): { clips: QueueClip[]; skipped: number } {
  const ready = detail.clips.filter((clip) => clip.status === "ready");

  return {
    clips: ready.map((clip) => ({ clipId: clip.id, title: clip.title, durationMs: clip.durationMs })),
    skipped: detail.clips.length - ready.length,
  };
}

/** The local half of the load notice. */
export function loadSummary(skipped: number): string | null {
  return skipped === 0 ? null : `Skipped ${skipped} ${skipped === 1 ? "clip" : "clips"} still processing`;
}
