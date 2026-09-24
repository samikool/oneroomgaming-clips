"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { useRealtimeContext } from "@/lib/realtime/provider";
import { ServerClock } from "./clock";
import { reduceChat } from "./chat-store";
import { startClockSampler } from "./sampler";
import { dismissRequest, INITIAL_ROOM_VIEW, reduceRoom, type RoomView } from "./room-store";

/** Long enough to read, short enough not to sit on the gameplay. */
const REACTION_LIFETIME_MS = 3_000;

/** A reaction on its way up the screen. `lane` keeps two from overlapping. */
export type FloatingReaction = { key: string; emoji: string; user: string; lane: number };

export type Room = {
  view: RoomView;
  chat: ChatMessage[];
  reactions: FloatingReaction[];
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
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const reactionSeq = useRef(0);
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
        setChat((current) => reduceChat(current, message));

        if (message.t === "reaction") {
          reactionSeq.current += 1;
          const key = `${message.at}-${reactionSeq.current}`;
          // The lane is derived, not random, so a re-render does not make a
          // reaction jump sideways mid-flight.
          const lane = reactionSeq.current % 5;
          setReactions((current) => [
            ...current.slice(-20),
            { key, emoji: message.emoji, user: message.user, lane },
          ]);
          setTimeout(
            () => setReactions((current) => current.filter((r) => r.key !== key)),
            REACTION_LIFETIME_MS,
          );
        }
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

  return { view, chat, reactions, clock, send, dismiss };
}
