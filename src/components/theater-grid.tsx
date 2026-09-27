"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ClipSummary } from "@/lib/realtime/envelope";

const QUEUED_FLASH_MS = 1_500;

/**
 * The theater's card actions for the clip browser. Anyone in the room can
 * queue a clip; the host can also put one on right now, which skips the queue
 * without touching it. Holds the brief "Queued #N" confirmation.
 */
export function useTheaterCardActions({
  iAmHost,
  queueLength,
  onQueue,
  onPlayNow,
}: {
  iAmHost: boolean;
  queueLength: number;
  onQueue(clip: ClipSummary): void;
  onPlayNow(clip: ClipSummary): void;
}): (clip: ClipSummary) => ReactNode {
  // Which card just queued, and at what position, for the brief confirmation.
  const [flash, setFlash] = useState<{ id: string; position: number } | null>(null);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timer = setTimeout(() => setFlash(null), QUEUED_FLASH_MS);

    return () => clearTimeout(timer);
  }, [flash]);

  return useCallback(
    (clip: ClipSummary) => (
      <div className="theater-card-actions">
        {flash?.id === clip.id ? (
          <span className="theater-card-flash font-pixel" role="status">
            Queued #{flash.position}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                onQueue(clip);
                // Optimistic: the server's snapshot is the truth, but it
                // lands after the flash would have been useful.
                setFlash({ id: clip.id, position: queueLength + 1 });
              }}
            >
              Queue
            </button>
            {iAmHost && (
              <button type="button" className="button-secondary theater-card-now" onClick={() => onPlayNow(clip)}>
                Play now
              </button>
            )}
          </>
        )}
      </div>
    ),
    [flash, iAmHost, queueLength, onQueue, onPlayNow],
  );
}
