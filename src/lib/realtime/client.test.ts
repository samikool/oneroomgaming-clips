import { describe, expect, it } from "bun:test";
import { backoffDelay, createRealtimeClient, type SocketLike } from "@/lib/realtime/client";
import type { ServerMessage } from "@/lib/realtime/envelope";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  open() {
    this.onopen?.();
  }

  deliver(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("backoffDelay", () => {
  it("grows with each attempt", () => {
    expect(backoffDelay(0, () => 0)).toBeLessThan(backoffDelay(3, () => 0));
  });

  it("is capped", () => {
    expect(backoffDelay(50, () => 1)).toBeLessThanOrEqual(30_000);
  });

  it("applies jitter so a mass reconnect does not stampede", () => {
    expect(backoffDelay(3, () => 0)).not.toBe(backoffDelay(3, () => 1));
  });
});

describe("createRealtimeClient", () => {
  it("subscribes on open", () => {
    const socket = new FakeSocket();
    createRealtimeClient({ url: "ws://x/ws", topics: ["grid"], socketFactory: () => socket });
    socket.open();

    expect(JSON.parse(socket.sent[0])).toEqual({ t: "sub", topics: ["grid"] });
  });

  it("delivers parsed messages to handlers", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => socket,
    });
    const seen: ServerMessage[] = [];
    client.on((m) => seen.push(m));
    socket.open();
    socket.deliver({ t: "presence", online: ["sam"] });

    expect(seen).toEqual([{ t: "presence", online: ["sam"] }]);
    client.close();
  });

  it("ignores an unparseable frame rather than throwing", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => socket,
    });
    const seen: ServerMessage[] = [];
    client.on((m) => seen.push(m));
    socket.open();

    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(seen).toEqual([]);
    client.close();
  });

  it("stops delivering to an unsubscribed handler", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => socket,
    });
    const seen: ServerMessage[] = [];
    const off = client.on((m) => seen.push(m));
    socket.open();
    off();
    socket.deliver({ t: "presence", online: ["sam"] });

    expect(seen).toEqual([]);
    client.close();
  });

  it("reconnects after a drop and re-subscribes on the new socket", async () => {
    const sockets: FakeSocket[] = [];
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      // Collapse the backoff so the test does not wait on real time.
      delayFor: () => 1,
    });

    sockets[0].open();
    sockets[0].close();
    await Bun.sleep(20);

    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(JSON.parse(sockets[1].sent[0])).toEqual({ t: "sub", topics: ["grid"] });
    client.close();
  });

  it("does not reconnect after close() is called", async () => {
    const sockets: FakeSocket[] = [];
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      delayFor: () => 1,
    });

    sockets[0].open();
    client.close();
    await Bun.sleep(20);

    expect(sockets).toHaveLength(1);
  });

  it("re-subscribes with the newest topics after a reconnect", async () => {
    const sockets: FakeSocket[] = [];
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      delayFor: () => 1,
    });

    sockets[0].open();
    client.subscribe(["grid", "user"]);
    sockets[0].close();
    await Bun.sleep(20);
    sockets[1].open();

    expect(JSON.parse(sockets[1].sent[0])).toEqual({ t: "sub", topics: ["grid", "user"] });
    client.close();
  });

  it("sends an arbitrary client message over the open socket", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["room"],
      socketFactory: () => socket,
      delayFor: () => 1,
    });
    socket.open();
    socket.sent.length = 0;

    client.send({ t: "sub", topics: ["room"] });

    expect(JSON.parse(socket.sent[0])).toEqual({ t: "sub", topics: ["room"] });
    client.close();
  });

  it("drops a send while the socket is down rather than throwing", () => {
    // A user clicking Play during a reconnect must not get an exception; the
    // snapshot that follows a reconnect corrects them anyway.
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["room"],
      socketFactory: () => {
        throw new Error("cannot connect");
      },
      delayFor: () => 1,
    });

    expect(() => client.send({ t: "sub", topics: ["room"] })).not.toThrow();
    client.close();
  });
});
