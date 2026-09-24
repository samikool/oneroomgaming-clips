"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeClient, type RealtimeClient } from "./client";
import type { ClientMessage, ServerMessage, Topic } from "./envelope";
import { unionTopics } from "./topics";

type Registration = { topics: Topic[]; handler: (message: ServerMessage) => void };

type RealtimeContextValue = {
  register(registration: Registration): () => void;
  send(message: ClientMessage): void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Holds the one socket for the whole tab.
 *
 * Milestone 4 gave every `useRealtime` call its own socket, which was three on
 * the home page alone. The theater cannot work that way: the dock and the
 * expanded view must see room snapshots in the same order, and two sockets
 * reconnecting independently do not guarantee that.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const registrations = useRef(new Set<Registration>());
  const clientRef = useRef<RealtimeClient | null>(null);
  const [, force] = useState(0);

  function currentTopics(): Topic[] {
    return unionTopics([...registrations.current].map((entry) => entry.topics));
  }

  useEffect(() => {
    // In production the socket is same-origin: Caddy routes /ws to the
    // realtime container, and this env var is unset. In local development
    // there is no proxy in front of Next, so it points straight at the
    // realtime process.
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const client = createRealtimeClient({
      url: process.env.NEXT_PUBLIC_REALTIME_WS_URL || `${scheme}://${location.host}/ws`,
      topics: currentTopics(),
    });
    clientRef.current = client;

    const off = client.on((message) => {
      // Snapshot: a handler may unregister during the loop.
      for (const entry of [...registrations.current]) {
        entry.handler(message);
      }
    });

    // Components that mounted before this effect ran registered against a null
    // client; now there is one, push the union they asked for.
    client.subscribe(currentTopics());
    force((n) => n + 1);

    return () => {
      off();
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      register(registration) {
        registrations.current.add(registration);
        clientRef.current?.subscribe(currentTopics());

        return () => {
          registrations.current.delete(registration);
          clientRef.current?.subscribe(currentTopics());
        };
      },
      send(message) {
        clientRef.current?.send(message);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeContext(): RealtimeContextValue {
  const value = useContext(RealtimeContext);

  if (!value) {
    throw new Error("useRealtime must be used inside <RealtimeProvider>");
  }

  return value;
}

export function useRealtimeSend(): (message: ClientMessage) => void {
  return useRealtimeContext().send;
}
