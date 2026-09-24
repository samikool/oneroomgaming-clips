import { isEphemeral, topicsFor, type ServerMessage, type Topic } from "@/lib/realtime/envelope";

export type Sendable = {
  send(data: string): void;
  readonly bufferedAmount?: number;
};

/**
 * Past this queue depth a socket is treated as backed up. Ephemeral messages
 * are dropped for it; clip lifecycle is still delivered, because a client that
 * misses "this clip is ready" never recovers on its own.
 */
export const MAX_BUFFERED_BYTES = 1_048_576;

type Entry = { username: string; topics: Set<Topic> };

export class Hub {
  readonly #sockets = new Map<Sendable, Entry>();

  add(socket: Sendable, username: string): void {
    this.#sockets.set(socket, { username, topics: new Set() });
  }

  remove(socket: Sendable): void {
    this.#sockets.delete(socket);
  }

  subscribe(socket: Sendable, topics: Topic[]): void {
    const entry = this.#sockets.get(socket);

    if (entry) {
      entry.topics = new Set(topics);
    }
  }

  get size(): number {
    return this.#sockets.size;
  }

  /** Distinct usernames, so one person with two tabs open counts once. */
  get online(): string[] {
    return [...new Set([...this.#sockets.values()].map((entry) => entry.username))];
  }

  publish(message: ServerMessage): number {
    const topics = topicsFor(message);
    const droppable = isEphemeral(message);
    const payload = JSON.stringify(message);
    let delivered = 0;

    // Iterate a snapshot: a throwing socket is deleted mid-loop.
    for (const [socket, entry] of [...this.#sockets.entries()]) {
      if (!topics.some((topic) => entry.topics.has(topic))) {
        continue;
      }

      if (droppable && (socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        continue;
      }

      try {
        socket.send(payload);
        delivered += 1;
      } catch {
        this.#sockets.delete(socket);
      }
    }

    return delivered;
  }

  /**
   * Deliver to one person's sockets rather than a topic.
   *
   * `room.controlRequested` is the only message with a single recipient: the
   * host. Broadcasting it on the room topic would show everyone in the theater
   * a prompt only the host can act on.
   *
   * Still gated on the message's topic — a socket that never asked for `room`
   * should not receive room messages by virtue of who is holding it.
   */
  sendTo(username: string, message: ServerMessage): number {
    const topics = topicsFor(message);
    const payload = JSON.stringify(message);
    let delivered = 0;

    for (const [socket, entry] of [...this.#sockets.entries()]) {
      if (entry.username !== username || !topics.some((topic) => entry.topics.has(topic))) {
        continue;
      }

      try {
        socket.send(payload);
        delivered += 1;
      } catch {
        this.#sockets.delete(socket);
      }
    }

    return delivered;
  }
}
