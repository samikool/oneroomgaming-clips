import { describe, expect, it } from "bun:test";
import { Hub, type Sendable } from "@/realtime/hub";

function fakeSocket() {
  const sent: string[] = [];
  return { sent, socket: { send: (data: string) => sent.push(data) } satisfies Sendable };
}

describe("Hub", () => {
  it("starts empty", () => {
    expect(new Hub().size).toBe(0);
  });

  it("counts added sockets", () => {
    const hub = new Hub();
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "dave");

    expect(hub.size).toBe(2);
  });

  it("broadcasts a serialised message to every socket", () => {
    const hub = new Hub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.socket, "sam");
    hub.add(b.socket, "dave");

    const delivered = hub.broadcast({ t: "hello" });

    expect(delivered).toBe(2);
    expect(a.sent).toEqual(['{"t":"hello"}']);
    expect(b.sent).toEqual(['{"t":"hello"}']);
  });

  it("stops sending to a removed socket", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");
    hub.remove(a.socket);

    expect(hub.broadcast({ t: "hello" })).toBe(0);
    expect(a.sent).toEqual([]);
  });

  it("keeps delivering to healthy sockets when one throws", () => {
    const hub = new Hub();
    const healthy = fakeSocket();
    hub.add({ send: () => { throw new Error("socket closed"); } }, "broken");
    hub.add(healthy.socket, "sam");

    expect(hub.broadcast({ t: "hello" })).toBe(1);
    expect(healthy.sent).toEqual(['{"t":"hello"}']);
  });

  it("drops a socket that threw on send", () => {
    const hub = new Hub();
    hub.add({ send: () => { throw new Error("socket closed"); } }, "broken");

    hub.broadcast({ t: "hello" });

    expect(hub.size).toBe(0);
  });
});
