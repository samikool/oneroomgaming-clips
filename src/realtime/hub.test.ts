import { describe, expect, it } from "bun:test";
import { Hub, MAX_BUFFERED_BYTES, type Sendable } from "@/realtime/hub";
import type { ServerMessage } from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC",
  title: "ace",
  status: "ready",
  thumbPath: null,
  durationMs: null,
  createdAt: 1,
};
const clipAdded: ServerMessage = { t: "clip.added", clip };
const progress: ServerMessage = { t: "upload.progress", uploadId: "u1", pct: 5, user: "sam" };

function fakeSocket(bufferedAmount = 0) {
  const sent: string[] = [];
  return {
    sent,
    socket: { send: (data: string) => sent.push(data), bufferedAmount } satisfies Sendable,
  };
}

describe("Hub", () => {
  it("starts empty", () => {
    expect(new Hub().size).toBe(0);
  });

  it("does not deliver to a socket that subscribed to nothing", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");

    expect(hub.publish(clipAdded)).toBe(0);
    expect(a.sent).toEqual([]);
  });

  it("delivers only to sockets subscribed to the message's topic", () => {
    const hub = new Hub();
    const grid = fakeSocket();
    const userOnly = fakeSocket();
    hub.add(grid.socket, "sam");
    hub.add(userOnly.socket, "dave");
    hub.subscribe(grid.socket, ["grid"]);
    hub.subscribe(userOnly.socket, ["user"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(grid.sent).toHaveLength(1);
    expect(userOnly.sent).toEqual([]);
  });

  it("replaces subscriptions rather than accumulating them", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");
    hub.subscribe(a.socket, ["grid"]);
    hub.subscribe(a.socket, ["user"]);

    expect(hub.publish(clipAdded)).toBe(0);
  });

  it("drops ephemeral messages to a backed-up socket", () => {
    const hub = new Hub();
    const slow = fakeSocket(MAX_BUFFERED_BYTES + 1);
    hub.add(slow.socket, "sam");
    hub.subscribe(slow.socket, ["grid"]);

    expect(hub.publish(progress)).toBe(0);
    expect(slow.sent).toEqual([]);
  });

  it("still delivers clip lifecycle to a backed-up socket", () => {
    const hub = new Hub();
    const slow = fakeSocket(MAX_BUFFERED_BYTES + 1);
    hub.add(slow.socket, "sam");
    hub.subscribe(slow.socket, ["grid"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(slow.sent).toHaveLength(1);
  });

  it("keeps delivering to healthy sockets when one throws, and evicts the thrower", () => {
    const hub = new Hub();
    const healthy = fakeSocket();
    const broken: Sendable = {
      send: () => {
        throw new Error("closed");
      },
    };
    hub.add(broken, "broken");
    hub.add(healthy.socket, "sam");
    hub.subscribe(broken, ["grid"]);
    hub.subscribe(healthy.socket, ["grid"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(healthy.sent).toHaveLength(1);
    expect(hub.size).toBe(1);
  });

  it("reports distinct usernames as online", () => {
    const hub = new Hub();
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "dave");

    expect(hub.online.sort()).toEqual(["dave", "sam"]);
  });

  it("forgets a username once its last socket goes", () => {
    const hub = new Hub();
    const first = fakeSocket();
    const second = fakeSocket();
    hub.add(first.socket, "sam");
    hub.add(second.socket, "sam");

    hub.remove(first.socket);
    expect(hub.online).toEqual(["sam"]);

    hub.remove(second.socket);
    expect(hub.online).toEqual([]);
  });
});
