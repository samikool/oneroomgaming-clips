"use client";
import { useEffect, useRef, useState } from "react";
import { VIEW_MIN_MS } from "@/lib/activity/scoring";
import { nextWatched } from "@/lib/activity/watch-time";
import { clampStart } from "@/lib/share/timestamp";
import { useClipPlayhead } from "./clip-playhead";

/**
 * The clip's video. Reports one view per page load once 3 seconds have
 * actually played — seeking doesn't count toward it.
 *
 * `start` is the page's parsed `?t=`: the video seeks there once its length is
 * known, clamped inside the clip. Autoplay is left to the browser.
 */
export function ClipPlayer({ src, clipId, start = null }: { src: string; clipId: string; start?: number | null }) {
  const [failed, setFailed] = useState(false);
  const watch = useRef({ prev: 0, total: 0, reported: false });
  const { videoRef } = useClipPlayhead();
  const applied = useRef<number | null>(null);

  function applyStart(video: HTMLVideoElement) {
    if (start === null || applied.current === start || !Number.isFinite(video.duration)) {
      return;
    }

    applied.current = start;
    const at = clampStart(start, video.duration);
    video.currentTime = at;
    // A jump is not watching; don't let it count toward the view.
    watch.current.prev = at;
  }

  // A new `?t=` on the same page (a link clicked here) seeks the loaded video.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) applyStart(video);
  });

  function onTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const now = event.currentTarget.currentTime;
    const w = watch.current;
    w.total = nextWatched(w.prev, now, w.total);
    w.prev = now;

    if (!w.reported && w.total >= VIEW_MIN_MS) {
      w.reported = true;
      // A lost view is a soft signal; nothing to retry or show.
      void fetch(`/api/clips/${clipId}/view`, { method: "POST" }).catch(() => {});
    }
  }

  return <>
    <video ref={videoRef} className="w-full rounded-lg bg-black" src={src} controls preload="metadata" playsInline
      onTimeUpdate={onTimeUpdate}
      onSeeking={(event) => { watch.current.prev = event.currentTarget.currentTime; }}
      onError={() => setFailed(true)}
      onLoadedMetadata={(event) => { setFailed(false); applyStart(event.currentTarget); }} />
    {failed && <p role="alert" className="mt-4 text-rose-300">This video could not be loaded. Try refreshing the page, or ask the uploader to check the file.</p>}
  </>;
}
