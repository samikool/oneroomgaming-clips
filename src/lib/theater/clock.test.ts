import { describe, expect, it } from "bun:test";
import { offsetFromSamples, ServerClock, type ClockSample } from "@/lib/theater/clock";

/** A sample for a client whose clock is `offset` ms behind the server. */
function sample(offset: number, rtt: number, asymmetry = 0): ClockSample {
  const t0 = 1_000;
  const t2 = t0 + rtt;
  // The server stamps t1 somewhere inside the round trip.
  const t1 = t0 + rtt / 2 + asymmetry + offset;
  return { t0, t1, t2 };
}

describe("offsetFromSamples", () => {
  it("is zero with no samples, so an unsampled clock is simply the local one", () => {
    expect(offsetFromSamples([])).toBe(0);
  });

  it("recovers a clean offset from a symmetric round trip", () => {
    expect(offsetFromSamples([sample(4_000, 40)])).toBe(4_000);
  });

  it("keeps the lowest-RTT sample, not the average", () => {
    // The long samples are badly distorted; a mean would drag the answer away.
    const samples = [sample(4_000, 500, 200), sample(4_000, 20), sample(4_000, 600, -250)];
    expect(offsetFromSamples(samples)).toBe(4_000);
  });

  it("handles a client running ahead of the server", () => {
    expect(offsetFromSamples([sample(-2_500, 30)])).toBe(-2_500);
  });
});

describe("ServerClock", () => {
  it("reports the local clock until it has a sample", () => {
    const clock = new ServerClock();
    expect(clock.sampled).toBe(false);
    expect(clock.now(1_234)).toBe(1_234);
  });

  it("shifts local time by the measured offset", () => {
    const clock = new ServerClock();
    clock.record(sample(4_000, 40));

    expect(clock.sampled).toBe(true);
    expect(clock.now(1_000)).toBe(5_000);
  });

  it("keeps only the most recent window of samples", () => {
    const clock = new ServerClock();
    // Six samples at a large offset, then five at a small one: the old ones
    // must have fallen out of the window entirely.
    for (let i = 0; i < 6; i += 1) {
      clock.record(sample(10_000, 30));
    }

    for (let i = 0; i < 5; i += 1) {
      clock.record(sample(100, 30));
    }

    expect(clock.offset).toBe(100);
  });

  it("prefers a low-RTT sample inside the window over a newer noisy one", () => {
    const clock = new ServerClock();
    clock.record(sample(4_000, 10));
    clock.record(sample(4_000, 800, 300));

    expect(clock.offset).toBe(4_000);
  });
});
