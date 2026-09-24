"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { RoomState } from "@/lib/realtime/envelope";
import { positionNow } from "@/lib/realtime/room-state";

/**
 * The room's transport.
 *
 * For a follower every control is visibly disabled with a "following <name>"
 * label — disabled-and-explained, never hidden, because hidden controls make
 * everyone assume the site is broken. Clicking one sends `room.requestControl`
 * instead of doing nothing, which turns the most likely misclick, poking a
 * dead scrubber, into the action the user actually wanted.
 *
 * None of this is enforcement. The realtime service authorizes every command
 * against `hostUserId`; a follower's frame is dropped in silence whatever this
 * component renders.
 */
export function TheaterTransport({
  state,
  clock,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onRequestControl,
}: {
  state: RoomState;
  clock: { now(localNow: number): number };
  canControl: boolean;
  onPlay(): void;
  onPause(): void;
  onSeek(positionMs: number): void;
  onRequestControl(): void;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (state.paused) {
      return;
    }

    const timer = setInterval(() => tick((n) => n + 1), 250);

    return () => clearInterval(timer);
  }, [state.paused]);

  const position = positionNow(state, clock.now(Date.now()));
  const duration = state.clipDurationMs ?? 0;
  const disabled = !canControl;

  return (
    <div className="theater-transport">
      <button
        type="button"
        className="button-secondary"
        aria-disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        onClick={() => {
          if (!canControl) {
            onRequestControl();
            return;
          }

          if (state.paused) {
            onPlay();
          } else {
            onPause();
          }
        }}
      >
        {state.paused ? "Play" : "Pause"}
      </button>
      <input
        type="range"
        className="theater-scrubber"
        min={0}
        max={Math.max(duration, 1)}
        value={Math.min(position, duration || position)}
        aria-label="Position"
        aria-disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        // `readOnly` rather than `disabled`: a disabled input fires no pointer
        // events at all, and for a follower the click IS the request.
        readOnly={disabled}
        onPointerDown={disabled ? onRequestControl : undefined}
        onChange={(event) => {
          if (canControl) {
            onSeek(Number(event.target.value));
          }
        }}
      />
      <span className="shrink-0 text-xs text-ink-muted">
        {formatDuration(position)} / {formatDuration(state.clipDurationMs)}
      </span>
      {disabled && (
        <span className="shrink-0 text-xs text-ink-muted">
          {state.hostUserId === null ? "Nobody has control" : `following ${state.hostUserId}`}
        </span>
      )}
    </div>
  );
}
