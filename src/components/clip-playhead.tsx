"use client";

import { createContext, useContext, useMemo, useRef, type RefObject } from "react";

type Playhead = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Seeks the clip page's video, without navigating. False when there is none. */
  seek(ms: number): boolean;
  /** Where the video is, in whole milliseconds; 0 before it loads. */
  currentMs(): number;
};

const PlayheadContext = createContext<RefObject<HTMLVideoElement | null> | null>(null);

/**
 * Shares the clip page's `<video>` with the comment form, the comment list and
 * the share button, so each can read or move the playhead.
 */
export function ClipPlayheadProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  return <PlayheadContext value={videoRef}>{children}</PlayheadContext>;
}

export function useClipPlayhead(): Playhead {
  const shared = useContext(PlayheadContext);
  const own = useRef<HTMLVideoElement | null>(null);
  const videoRef = shared ?? own;

  return useMemo(
    () => ({
      videoRef,
      seek(ms: number) {
        const video = videoRef.current;

        if (!video) {
          return false;
        }

        const target = ms / 1000;
        video.currentTime = Number.isFinite(video.duration) ? Math.min(target, video.duration) : target;
        video.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return true;
      },
      currentMs() {
        return Math.round((videoRef.current?.currentTime ?? 0) * 1000);
      },
    }),
    [videoRef],
  );
}
