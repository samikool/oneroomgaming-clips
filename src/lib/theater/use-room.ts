"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { useRealtimeContext } from "@/lib/realtime/provider";
import { ServerClock } from "./clock";
import { startClockSampler } from "./sampler";
import { dismissRequest, INITIAL_ROOM_VIEW, reduceRoom, type RoomView } from "./room-store";

export type Room = {
  view: RoomView;
  clock: ServerClock;
  send(message: ClientMessage): void;
  dismiss(user: string): void;
};

/**
 * The room as this browser sees it, plus the clock that makes its numbers mean
 * anything.
 *
 * The clock sampler is started here rather than in the provider because the
 * handshake is only worth its traffic where something is actually syncing.
 */
export function useRoom(): Room {
  const { register, send } = useRealtimeContext();
  const [view, setView] = useState<RoomView>(INITIAL_ROOM_VIEW);
  const clock = useMemo(() => new ServerClock(), []);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const sampler = startClockSampler({
      clock,
      send: (message) => sendRef.current(message),
    });

    const unregister = register({
      topics: ["room", "grid"],
      handler: (message: ServerMessage) => {
        sampler.receive(message);
        setView((current) => reduceRoom(current, message, Date.now()));
      },
    });

    return () => {
      unregister();
      sampler.stop();
    };
  }, [register, clock]);

  const dismiss = useCallback((user: string) => {
    setView((current) => dismissRequest(current, user));
  }, []);

  return { view, clock, send, dismiss };
}
