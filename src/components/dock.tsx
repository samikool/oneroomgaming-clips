"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import { positionNow } from "@/lib/realtime/room-state";
import { useDockDismissed } from "@/lib/theater/use-dock-dismissed";
import { useRoom } from "@/lib/theater/use-room";
import { DockBadge } from "./dock-badge";

/**
 * Pinned to the bottom of every page, showing what the theater is playing.
 *
 * Chosen over a separate /theater route as the only surface — an always-on
 * room nobody can see is a dead room — and over theater-as-homepage, which is
 * a large empty box whenever nobody is watching.
 */
export function Dock({ me }: { me: string }) {
  const { view, clock, send } = useRoom();
  const [dismissed, setDismissed] = useDockDismissed();
  const [, tick] = useState(0);

  const { state } = view;
  const joined = view.inRoom.includes(me);

  // A ticking position while playing. One second is enough for a dock.
  useEffect(() => {
    if (state.paused || state.clipId === null) {
      return;
    }

    const timer = setInterval(() => tick((n) => n + 1), 1_000);

    return () => clearInterval(timer);
  }, [state.paused, state.clipId]);

  if (dismissed) {
    return (
      <div className="dock">
        <DockBadge
          watching={view.inRoom.length}
          activity={state.rev + view.inRoom.length}
          onExpand={() => setDismissed(false)}
        />
      </div>
    );
  }

  if (state.clipId === null) {
    return (
      <div className="dock dock-idle">
        <p className="text-xs text-ink-muted">
          The theater is empty.{" "}
          <Link href="/theater" className="underline hover:text-ink">
            Start something
          </Link>
          .
        </p>
      </div>
    );
  }

  const position = formatDuration(positionNow(state, clock.now(Date.now())));
  const duration = formatDuration(state.clipDurationMs);
  const host = state.hostUserId ?? "nobody";

  if (!joined) {
    return (
      <div className="dock dock-open">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">{state.clipTitle}</p>
          <p className="text-xs text-ink-muted">
            {state.hostUserId === null ? "Nobody has control" : `${host} is hosting`} ·{" "}
            {view.inRoom.length} watching · {position} / {duration}
          </p>
        </div>
        <button type="button" className="button-primary" onClick={() => send({ t: "room.join" })}>
          Join
        </button>
        <button
          type="button"
          className="dock-dismiss"
          aria-label="Collapse the theater dock"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
    );
  }

  // Joined. No × — the exit is Leave, which takes you out of presence. Hiding
  // your own controls while still synced to someone else's playhead is a bug
  // wearing a feature's clothes.
  return (
    <div className="dock dock-open">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{state.clipTitle}</p>
        <p className="text-xs text-ink-muted">
          {state.hostUserId === me ? "You have control" : `Following ${host}`} ·{" "}
          {view.inRoom.length} watching · {position} / {duration}
        </p>
      </div>
      <Link href="/theater" className="button-secondary">
        Open theater
      </Link>
      <button type="button" className="button-secondary" onClick={() => send({ t: "room.leave" })}>
        Leave
      </button>
    </div>
  );
}
