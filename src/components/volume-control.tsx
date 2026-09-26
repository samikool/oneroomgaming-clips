"use client";

import type { Volume } from "@/lib/theater/volume";

/**
 * Mute and level for this viewer only. Never disabled for followers: volume is
 * not a room command, so there is nothing to ask the host for.
 */
export function VolumeControl({ volume, onChange }: { volume: Volume; onChange(next: Volume): void }) {
  const silent = volume.muted || volume.level === 0;

  return (
    <div className="volume-control">
      <button
        type="button"
        className="queue-action"
        aria-label={silent ? "Unmute" : "Mute"}
        aria-pressed={volume.muted}
        onClick={() =>
          // Unmuting at zero would stay silent, so it comes back at half.
          onChange(
            volume.muted || volume.level === 0
              ? { muted: false, level: volume.level === 0 ? 0.5 : volume.level }
              : { ...volume, muted: true },
          )
        }
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
          {silent ? (
            <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.5" />
          ) : (
            <>
              <path d="M11 6.5a2 2 0 0 1 0 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              {volume.level > 0.5 && (
                <path d="M12.5 4.5a4.5 4.5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
              )}
            </>
          )}
        </svg>
      </button>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={100}
        value={silent ? 0 : Math.round(volume.level * 100)}
        aria-label="Volume"
        onChange={(event) => onChange({ level: Number(event.target.value) / 100, muted: false })}
      />
    </div>
  );
}
