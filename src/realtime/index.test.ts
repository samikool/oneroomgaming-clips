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

function connect(): WebSocket {
  // bun's WebSocket accepts headers; the service authenticates from this one.
  return new WebSocket(`ws://localhost:${PORT}/ws`, {
    headers: { "X-Authentik-Username": "sam" },
  } as unknown as string[]);
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
