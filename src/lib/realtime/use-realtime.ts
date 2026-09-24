"use client";

import { useEffect, useRef } from "react";
import type { ServerMessage, Topic } from "./envelope";
import { useRealtimeContext } from "./provider";

/**
 * Subscribes this component to the tab's shared socket for as long as it is
 * mounted.
 *
 * The handler lives in a ref so a caller passing an inline arrow — which is
 * every caller — does not re-register on each render.
 */
export function useRealtime(topics: Topic[], handler: (message: ServerMessage) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { register } = useRealtimeContext();
  const key = topics.join(",");

  useEffect(
    () =>
      register({
        topics: key.split(",") as Topic[],
        handler: (message) => handlerRef.current(message),
      }),
    [register, key],
  );
}
