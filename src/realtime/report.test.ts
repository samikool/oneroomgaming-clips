import { describe, expect, it } from "bun:test";
import { createReporter } from "./report";

describe("createReporter", () => {
  it("posts signed events and never waits for the answer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let release!: () => void;
    const hang = new Promise<Response>((resolve) => (release = () => resolve(new Response(null, { status: 204 }))));
    const report = createReporter({
      url: "http://web/api/internal/events",
      secret: "s",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return hang;
      }) as unknown as typeof fetch,
    });

    const started = performance.now();
    const result = report({ kind: "theater.play", user: "sam", clipId: "C1", at: 1 });
    expect(result).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(20);
    expect(calls[0].url).toBe("http://web/api/internal/events");
    expect(calls[0].init.headers).toMatchObject({ "X-Emit-Secret": "s" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: "theater.play", user: "sam", clipId: "C1", at: 1 });
    release();
  });

  it("swallows failures, logging once", async () => {
    const logged: unknown[] = [];
    const report = createReporter({
      url: "http://web/x",
      secret: "s",
      fetchImpl: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
      log: (...args) => logged.push(args),
    });
    expect(() => report({ kind: "theater.play", user: "sam", clipId: "C1", at: 1 })).not.toThrow();
    expect(() => report({ kind: "theater.play", user: "sam", clipId: "C1", at: 2 })).not.toThrow();
    await Bun.sleep(10);
    expect(logged).toHaveLength(1);
  });

  it("is a no-op without a url, and says so once", () => {
    const logged: unknown[] = [];
    const report = createReporter({ url: undefined, secret: "s", log: (...args) => logged.push(args) });
    expect(() => report({ kind: "theater.play", user: "sam", clipId: "C1", at: 1 })).not.toThrow();
    expect(logged).toHaveLength(1);
  });
});
