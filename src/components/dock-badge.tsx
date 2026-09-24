"use client";

import { useEffect, useRef, useState } from "react";
import { DOCK_PULSE_ENABLED } from "@/lib/theater/flags";

const PULSE_MS = 1_200;

/**
 * The collapsed dock: a live count that keeps ticking but stays silent.
 *
 * It never auto-expands. A dismissed dock that reopens itself is the reason
 * people dismiss things twice and then leave.
 */
export function DockBadge({
  watching,
  activity,
  onExpand,
}: {
  watching: number;
  /** Any value that changes when something happened worth a pulse. */
  activity: number;
  onExpand(): void;
}) {
  const [pulsing, setPulsing] = useState(false);
  const seen = useRef(activity);

  useEffect(() => {
    if (!DOCK_PULSE_ENABLED || activity === seen.current) {
      return;
    }

    seen.current = activity;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS);

    return () => clearTimeout(timer);
  }, [activity]);

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Show the theater dock — ${watching} watching`}
      className={`dock-badge ${pulsing ? "dock-badge-pulse" : ""}`}
    >
      <span aria-hidden="true">▶</span> {watching}
    </button>
  );
}
