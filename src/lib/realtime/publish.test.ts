import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { publish } from "@/lib/realtime/publish";
import type { ServerMessage } from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC",
  title: "ace",
  status: "ready",
  thumbPath: null,
  durationMs: null,
  createdAt: 1,
};
const message: ServerMessage = { t: "clip.updated", clip };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("publish", () => {
  it("posts the message to REALTIME_URL with the emit secret", async () => {
    let seen: { url: string; secret: string | null; body: unknown } | undefined;

    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = {
        url: String(url),
        secret: new Headers(init.headers).get("X-Emit-Secret"),
        body: JSON.parse(String(init.body)),
      };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await publish(message, {
      REALTIME_URL: "http://realtime:3001",
      EMIT_SECRET: "s3cret",
    });

    expect(ok).toBe(true);
    expect(seen?.url).toBe("http://realtime:3001/emit");
    expect(seen?.secret).toBe("s3cret");
    expect(seen?.body).toEqual(message);
  });

  it("returns false and does not throw when realtime is unreachable", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    expect(
      await publish(message, {
        REALTIME_URL: "http://realtime:3001",
        EMIT_SECRET: "s3cret",
      }),
    ).toBe(false);
    warn.mockRestore();
  });

  it("returns false on a non-2xx response without throwing", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 403 })) as unknown as typeof fetch;

    expect(
      await publish(message, {
        REALTIME_URL: "http://realtime:3001",
        EMIT_SECRET: "s3cret",
      }),
    ).toBe(false);
  });

  it("skips silently when EMIT_SECRET is not configured", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    expect(await publish(message, { REALTIME_URL: "http://realtime:3001" })).toBe(false);
    expect(called).toBe(false);
    expect(warn).not.toHaveBeenCalled(); // explicit env: the operator warning is not for them
    warn.mockRestore();
  });

  it("skips silently when REALTIME_URL is not configured", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    expect(await publish(message, { EMIT_SECRET: "s3cret" })).toBe(false);
    expect(called).toBe(false);
    warn.mockRestore();
  });
});
