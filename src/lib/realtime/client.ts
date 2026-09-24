import type { ClientMessage, ServerMessage, Topic } from "./envelope";

export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
};

export type RealtimeClient = {
  subscribe(topics: Topic[]): void;
  send(message: ClientMessage): void;
  on(handler: (message: ServerMessage) => void): () => void;
  close(): void;
};

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff with jitter. The jitter is not decoration: a realtime
 * restart drops every client at the same instant, and without it they would
 * all retry in lockstep and restart the stampede on every failure.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function createRealtimeClient(options: {
  url: string;
  topics: Topic[];
  socketFactory?: (url: string) => SocketLike;
  delayFor?: (attempt: number) => number;
}): RealtimeClient {
  const factory =
    options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const delayFor = options.delayFor ?? backoffDelay;
  const handlers = new Set<(message: ServerMessage) => void>();

  let topics = options.topics;
  let socket: SocketLike | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    if (stopped) {
      return;
    }

    let next: SocketLike;

    try {
      next = factory(options.url);
    } catch {
      // A constructor that throws (blocked URL, no network) must behave like a
      // socket that opened and closed: retry, never propagate to the caller.
      timer = setTimeout(connect, delayFor(attempt));
      attempt += 1;
      return;
    }

    socket = next;

    next.onopen = () => {
      attempt = 0;
      // Always the current topics, not the ones this client was created with:
      // a reconnect must restore whatever the caller last asked for.
      next.send(JSON.stringify({ t: "sub", topics }));
    };

    next.onmessage = (event) => {
      let message: ServerMessage;

      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      for (const handler of [...handlers]) {
        handler(message);
      }
    };

    next.onclose = () => {
      if (stopped) {
        return;
      }

      timer = setTimeout(connect, delayFor(attempt));
      attempt += 1;
    };
  }

  connect();

  return {
    subscribe(next: Topic[]) {
      topics = next;
      socket?.send(JSON.stringify({ t: "sub", topics }));
    },
    send(message: ClientMessage) {
      // Best effort by design. The socket may be mid-reconnect; the snapshot
      // that follows a reconnect makes a dropped command self-correcting.
      try {
        socket?.send(JSON.stringify(message));
      } catch {
        // The socket is closing. The reconnect path already handles it.
      }
    },
    on(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
