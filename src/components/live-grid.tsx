"use client";

import { useMemo, useState } from "react";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ClipGrid } from "./clip-grid";

/**
 * The server-rendered clips are the snapshot; live events merge on top. There
 * is no fetch on connect — the page load already did that work.
 */
export function LiveGrid({ initial, live = true }: { initial: ClipSummary[]; live?: boolean }) {
  const [clips, setClips] = useState<ClipMap>(() =>
    Object.fromEntries(initial.map((clip) => [clip.id, clip])),
  );

  useRealtime(["grid"], (message) => {
    // On a filtered grid, merging a new clip would show one that does not
    // match the filter. Status updates for clips already shown stay live.
    if (!live && message.t === "clip.added") {
      return;
    }

    setClips((state) => mergeClip(state, message));
  });

  const ordered = useMemo(
    () => Object.values(clips).sort((a, b) => b.createdAt - a.createdAt),
    [clips],
  );

  return <ClipGrid clips={ordered} />;
}
