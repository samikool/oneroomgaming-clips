"use client";

import { useEffect, useState, type RefObject } from "react";
import { DEFAULT_VOLUME, parseStoredVolume, type Volume } from "./volume";

const KEY = "clips.theater.volume";

/**
 * This viewer's volume for the theater player. Purely local: it is applied to
 * this browser's <video> and never sent to the room, so anyone — host or not —
 * can turn themselves down without touching anyone else. Remembered per
 * browser; `videoKey` re-applies it when the player element is replaced.
 */
export function useVolume(
  video: RefObject<HTMLVideoElement | null>,
  videoKey: unknown,
): [Volume, (next: Volume) => void] {
  const [volume, setVolume] = useState<Volume>(DEFAULT_VOLUME);

  useEffect(() => {
    try {
      setVolume(parseStoredVolume(localStorage.getItem(KEY)));
    } catch {
      // Storage unavailable; full volume for this visit.
    }
  }, []);

  useEffect(() => {
    const el = video.current;

    if (el) {
      el.volume = volume.level;
      el.muted = volume.muted;
    }
  }, [video, videoKey, volume]);

  function update(next: Volume): void {
    setVolume(next);

    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not remembered; still applies now.
    }
  }

  return [volume, update];
}
