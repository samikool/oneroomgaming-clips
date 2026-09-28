import { describe, expect, it } from "bun:test";
import { createTokenSource } from "./token";

function fakeFetch(tokens: string[]) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    return Response.json({ access_token: tokens.shift(), expires_in: 3600, token_type: "bearer" });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("token source", () => {
  it("fetches once and reuses the token until near expiry", async () => {
    let now = 0;
    const { fn, calls } = fakeFetch(["a", "b"]);
    const source = createTokenSource("id", "secret", fn, () => now);

    expect(await source.get()).toBe("a");
    now = 3000 * 1000;
    expect(await source.get()).toBe("a");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("grant_type=client_credentials");

    now = 3590 * 1000; // inside the 60 s safety margin
    expect(await source.get()).toBe("b");
  });

  it("drops the token on invalidate", async () => {
    const { fn } = fakeFetch(["a", "b"]);
    const source = createTokenSource("id", "secret", fn, () => 0);
    await source.get();
    source.invalidate();
    expect(await source.get()).toBe("b");
  });

  it("throws on a non-2xx token response", async () => {
    const fn = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
    await expect(createTokenSource("id", "bad", fn, () => 0).get()).rejects.toThrow("token");
  });

  it("gives up on a token request that hangs", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    await expect(createTokenSource("id", "secret", hang, () => 0, 20).get()).rejects.toThrow();
  });
});
