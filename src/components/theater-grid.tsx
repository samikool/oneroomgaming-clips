"use client";

import { useEffect, useState } from "react";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { ClipTile } from "./clip-card";

const QUEUED_FLASH_MS = 1_500;

/**
 * Every ready clip, under the player. Anyone in the room can queue one; the
 * host can also put one on right now, which skips the queue without touching
 * it.
 */
export function TheaterGrid({
  clips,
  iAmHost,
  queueLength,
  onQueue,
  onPlayNow,
}: {
  clips: ClipSummary[];
  iAmHost: boolean;
  queueLength: number;
  onQueue(clip: ClipSummary): void;
  onPlayNow(clip: ClipSummary): void;
}) {
  // Which card just queued, and at what position, for the brief confirmation.
  const [flash, setFlash] = useState<{ id: string; position: number } | null>(null);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timer = setTimeout(() => setFlash(null), QUEUED_FLASH_MS);

    return () => clearTimeout(timer);
  }, [flash]);

  if (clips.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing is ready to play yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {clips.map((clip) => (
        <div key={clip.id} className="theater-card">
          <ClipTile
            clip={clip}
            overlay={
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
            }
          />
        </div>
      ))}
    </div>
  );
}
