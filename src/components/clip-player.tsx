"use client";
import { useRef, useState } from "react";
import { VIEW_MIN_MS } from "@/lib/activity/scoring";
import { nextWatched } from "@/lib/activity/watch-time";

/**
 * The clip's video. Reports one view per page load once 3 seconds have
 * actually played — seeking doesn't count toward it.
 */
export function ClipPlayer({ src, clipId }: { src: string; clipId: string }) {
  const [failed, setFailed] = useState(false);
  const watch = useRef({ prev: 0, total: 0, reported: false });

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
    <video className="w-full rounded-lg bg-black" src={src} controls preload="metadata" playsInline
      onTimeUpdate={onTimeUpdate}
      onSeeking={(event) => { watch.current.prev = event.currentTarget.currentTime; }}
      onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)} />
    {failed && <p role="alert" className="mt-4 text-rose-300">This video could not be loaded. Try refreshing the page, or ask the uploader to check the file.</p>}
  </>;
}
