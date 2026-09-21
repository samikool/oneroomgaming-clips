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
