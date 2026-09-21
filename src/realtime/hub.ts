export type Sendable = { send(data: string): void };

export class Hub {
  readonly #sockets = new Map<Sendable, string>();

  add(socket: Sendable, username: string): void {
    this.#sockets.set(socket, username);
  }

  remove(socket: Sendable): void {
    this.#sockets.delete(socket);
  }

  get size(): number {
    return this.#sockets.size;
  }

  broadcast(message: unknown): number {
    const payload = JSON.stringify(message);
    let delivered = 0;

    for (const socket of [...this.#sockets.keys()]) {
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
