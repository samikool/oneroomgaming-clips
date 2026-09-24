"use client";

import { useState } from "react";
import { useRealtime } from "@/lib/realtime/use-realtime";

/**
 * Starts optimistically listing just you, so the bar never flashes empty
 * between the page rendering and the socket's first presence message.
 */
export function PresenceBar({ me }: { me: string }) {
  const [online, setOnline] = useState<string[]>([me]);

  useRealtime(["grid"], (message) => {
    if (message.t === "presence") {
      setOnline(message.online);
    }
  });

  const others = online.filter((name) => name !== me);

  return (
    <p className="text-sm text-ink-muted">
      {others.length === 0 ? "You're the only one here" : `Here now: ${others.join(", ")}`}
    </p>
  );
}
