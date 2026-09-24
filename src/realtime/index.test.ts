import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "node:http";

const PORT = 3099;
let server: Server;

beforeAll(async () => {
  process.env.EMIT_SECRET = "test-secret";
  process.env.REALTIME_PORT = String(PORT);
  server = (await import("./index")).server;
  await Bun.sleep(150);
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("POST /emit", () => {
  it("answers 413 with a readable response when the body exceeds the cap", async () => {
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret" },
      body: "x".repeat(70 * 1024),
    });

    expect(response.status).toBe(413);
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret" },
      body: "not json",
    });

    expect(response.status).toBe(400);
  });
});

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), {
      once: true,
    });
  });
}

function connect(username = "sam"): WebSocket {
  // bun's WebSocket accepts headers; the service authenticates from this one.
  return new WebSocket(`ws://localhost:${PORT}/ws`, {
    headers: { "X-Authentik-Username": username },
  } as unknown as string[]);
}

/**
 * Waits for the first message matching `predicate`.
 *
 * The room tests need this rather than `nextMessage`: a single action can
 * produce a room snapshot and a presence update, and which arrives first is
 * not what any of them are asserting.
 */
function waitFor(
  ws: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("timed out waiting for a message"));
    }, 2_000);

    function onMessage(event: MessageEvent) {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;

      if (predicate(message)) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve(message);
      }
    }

    ws.addEventListener("message", onMessage);
  });
}

/** Opens a socket, waits for hello, subscribes to `room`, waits for the snapshot. */
async function joinRoomTopic(username: string): Promise<WebSocket> {
  const ws = connect(username);
  await waitFor(ws, (m) => m.t === "hello");
  ws.send(JSON.stringify({ t: "sub", topics: ["room"] }));
  await waitFor(ws, (m) => m.t === "room");
  return ws;
}

function state(message: Record<string, unknown>): Record<string, unknown> {
  return message.state as Record<string, unknown>;
}

describe("websocket protocol", () => {
  it("greets a new socket with hello", async () => {
    const ws = connect();
    const hello = await nextMessage(ws);

    expect(hello.t).toBe("hello");
    expect(hello.username).toBe("sam");
    ws.close();
  });

  it("answers time.sync with the server clock", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "time.sync", t0: 111 }));

    const reply = await nextMessage(ws);
    expect(reply.t).toBe("time.sync");
    expect(reply.t0).toBe(111);
    expect(typeof reply.t1).toBe("number");
    ws.close();
  });

  it("sends presence immediately on subscribe", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));

    const presence = await nextMessage(ws);
    expect(presence.t).toBe("presence");
    expect(presence.online).toContain("sam");
    ws.close();
  });

  it("delivers an emitted clip event to a grid subscriber", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));
    await nextMessage(ws);

    const received = nextMessage(ws);
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        t: "clip.added",
        clip: {
          id: "01ABC",
          title: "ace",
          status: "pending",
          thumbPath: null,
          durationMs: null,
          createdAt: 1,
        },
      }),
    });

    expect(response.status).toBe(200);
    expect((await received).t).toBe("clip.added");
    ws.close();
  });

  it("rejects an emit body that is not a message object", async () => {
    const response = await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret", "content-type": "application/json" },
      body: JSON.stringify(["not", "a", "message"]),
    });

    expect(response.status).toBe(400);
  });

  it("survives a malformed frame without dropping the connection", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send("not json at all");
    ws.send(JSON.stringify({ t: "time.sync", t0: 222 }));

    const reply = await nextMessage(ws);
    expect(reply.t0).toBe(222);
    ws.close();
  });
});

// These tests share one long-lived Room across the file, so each uses distinct
// usernames and asserts on transitions rather than absolute state. A per-test
// reset would need an export that exists only for tests.
describe("room over the socket", () => {
  it("hands a fresh subscriber the current snapshot", async () => {
    const ws = await joinRoomTopic("snapshot-watcher");
    ws.close();
  });

  it("does not send a snapshot to a grid-only subscriber", async () => {
    const ws = connect("grid-only");
    await waitFor(ws, (m) => m.t === "hello");
    ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));
    await waitFor(ws, (m) => m.t === "presence");

    let sawRoom = false;
    ws.addEventListener("message", (event) => {
      if ((JSON.parse(String(event.data)) as { t: string }).t === "room") {
        sawRoom = true;
      }
    });
    await Bun.sleep(100);

    expect(sawRoom).toBe(false);
    ws.close();
  });

  it("makes the first joiner host and tells everyone", async () => {
    const ws = await joinRoomTopic("first-in");
    ws.send(JSON.stringify({ t: "room.join" }));

    const message = await waitFor(ws, (m) => m.t === "room" && state(m).hostUserId === "first-in");
    expect(state(message).paused).toBe(true);
    ws.close();
  });

  it("reports room membership in presence", async () => {
    const ws = await joinRoomTopic("presence-member");
    ws.send(JSON.stringify({ t: "room.join" }));

    const presence = await waitFor(
      ws,
      (m) => m.t === "presence" && (m.inRoom as string[]).includes("presence-member"),
    );
    expect(presence.inRoom).toContain("presence-member");
    ws.send(JSON.stringify({ t: "room.leave" }));
    await waitFor(ws, (m) => m.t === "presence" && !(m.inRoom as string[]).includes("presence-member"));
    ws.close();
  });

  it("drops a follower's control command without answering", async () => {
    const host = await joinRoomTopic("the-host");
    const follower = await joinRoomTopic("the-follower");
    host.send(JSON.stringify({ t: "room.join" }));
    await waitFor(host, (m) => m.t === "room" && state(m).hostUserId === "the-host");
    follower.send(JSON.stringify({ t: "room.join" }));
    await waitFor(follower, (m) => m.t === "presence" && (m.inRoom as string[]).includes("the-follower"));
    host.send(
      JSON.stringify({
        t: "room.control",
        action: "setClip",
        clipId: "01A",
        title: "ace",
        durationMs: 30_000,
      }),
    );
    const playing = await waitFor(follower, (m) => m.t === "room" && state(m).clipId === "01A");
    const revBefore = state(playing).rev as number;

    follower.send(JSON.stringify({ t: "room.control", action: "pause" }));
    await Bun.sleep(100);
    host.send(JSON.stringify({ t: "room.control", action: "seek", positionMs: 1_000 }));
    const after = await waitFor(follower, (m) => m.t === "room" && state(m).positionMs === 1_000);

    // The follower's pause produced no snapshot between the two: rev moved by
    // exactly one, for the host's seek.
    expect(state(after).rev).toBe(revBefore + 1);
    expect(state(after).paused).toBe(false);
    host.close();
    follower.close();
  });

  it("sends a control request to the host alone", async () => {
    const host = await joinRoomTopic("req-host");
    const asker = await joinRoomTopic("req-asker");
    const bystander = await joinRoomTopic("req-bystander");
    host.send(JSON.stringify({ t: "room.join" }));
    await waitFor(host, (m) => m.t === "room" && state(m).hostUserId === "req-host");
    asker.send(JSON.stringify({ t: "room.join" }));
    await waitFor(asker, (m) => m.t === "presence" && (m.inRoom as string[]).includes("req-asker"));

    const waiting = waitFor(host, (m) => m.t === "room.controlRequested");
    let bystanderSaw = false;
    bystander.addEventListener("message", (event) => {
      if ((JSON.parse(String(event.data)) as { t: string }).t === "room.controlRequested") {
        bystanderSaw = true;
      }
    });

    asker.send(JSON.stringify({ t: "room.requestControl" }));
    expect(await waiting).toEqual({ t: "room.controlRequested", user: "req-asker" });
    expect(bystanderSaw).toBe(false);
    host.close();
    asker.close();
    bystander.close();
  });

  it("goes hostless and pauses when the host's socket drops", async () => {
    const host = await joinRoomTopic("drop-host");
    const watcher = await joinRoomTopic("drop-watcher");
    host.send(JSON.stringify({ t: "room.join" }));
    await waitFor(watcher, (m) => m.t === "room" && state(m).hostUserId === "drop-host");

    host.close();
    const message = await waitFor(watcher, (m) => m.t === "room" && state(m).hostUserId === null);
    expect(state(message).paused).toBe(true);
    watcher.close();
  });
});
