"use client";

import { useEffect, useRef } from "react";
import { createRealtimeClient } from "./client";
import type { ServerMessage, Topic } from "./envelope";

/**
 * Holds one socket for as long as the component is mounted.
 *
 * The handler lives in a ref so a caller passing an inline arrow — which is
 * every caller — does not tear the socket down and rebuild it on each render.
 */
export function useRealtime(topics: Topic[], handler: (message: ServerMessage) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const key = topics.join(",");

  useEffect(() => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const client = createRealtimeClient({
      url: `${scheme}://${location.host}/ws`,
      topics: key.split(",") as Topic[],
    });
    const off = client.on((message) => handlerRef.current(message));

    return () => {
      off();
      client.close();
    };
  }, [key]);
}
