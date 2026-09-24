import { describe, expect, it } from "bun:test";
import { RateLimiter } from "@/realtime/rate-limit";

function limiterAt(cooldown: number, start = 1_000) {
  let clock = start;
  return { limiter: new RateLimiter(cooldown, () => clock), advance: (ms: number) => (clock += ms) };
}

describe("RateLimiter", () => {
  it("allows the first take", () => {
    expect(limiterAt(1_000).limiter.take("sam")).toBe(true);
  });

  it("refuses a second take inside the cooldown", () => {
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(999);

    expect(limiter.take("sam")).toBe(false);
  });

  it("allows another take once the cooldown has elapsed", () => {
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(1_000);

    expect(limiter.take("sam")).toBe(true);
  });

  it("limits per key, not globally", () => {
    const { limiter } = limiterAt(1_000);
    limiter.take("sam");

    expect(limiter.take("dave")).toBe(true);
  });

  it("does not extend the cooldown on a refused take", () => {
    // A limiter that records the ATTEMPT rather than the SUCCESS locks out
    // anyone who double-clicks, for as long as they keep trying.
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(600);
    limiter.take("sam");
    advance(400);

    expect(limiter.take("sam")).toBe(true);
  });
});
