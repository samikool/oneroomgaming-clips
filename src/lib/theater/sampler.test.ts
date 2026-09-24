import { describe, expect, it } from "bun:test";
import type { ClientMessage } from "@/lib/realtime/envelope";
import { ServerClock } from "@/lib/theater/clock";
import { startClockSampler } from "@/lib/theater/sampler";

function harness() {
  const sent: ClientMessage[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let clock = 1_000;
  const serverClock = new ServerClock();

  const sampler = startClockSampler({
    clock: serverClock,
    send: (message) => sent.push(message),
    now: () => clock,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: () => {},
  });

  return {
    sent,
    timers,
    serverClock,
    stop: sampler.stop,
    receive: sampler.receive,
    advance: (ms: number) => (clock += ms),
    fireTimers: () => {
      for (const timer of timers.splice(0, timers.length)) {
        timer.fn();
      }
    },
  };
}

describe("startClockSampler", () => {
  it("sends a first sample immediately", () => {
    const h = harness();
    expect(h.sent).toEqual([{ t: "time.sync", t0: 1_000 }]);
    h.stop();
  });

  it("feeds a reply into the clock", () => {
    const h = harness();
    h.advance(40);
    h.receive({ t: "time.sync", t0: 1_000, t1: 5_020 });

    expect(h.serverClock.sampled).toBe(true);
    expect(h.serverClock.offset).toBe(4_000);
    h.stop();
  });

  it("ignores a reply whose t0 it never sent", () => {
    // Otherwise a stray or replayed frame could inject an arbitrary offset.
    const h = harness();
    h.receive({ t: "time.sync", t0: 999_999, t1: 5_000 });

    expect(h.serverClock.sampled).toBe(false);
    h.stop();
  });

  it("ignores a second reply for the same t0", () => {
    const h = harness();
    h.advance(40);
    h.receive({ t: "time.sync", t0: 1_000, t1: 5_020 });
    h.receive({ t: "time.sync", t0: 1_000, t1: 9_999 });

    expect(h.serverClock.offset).toBe(4_000);
    h.stop();
  });

  it("ignores messages that are not time.sync", () => {
    const h = harness();
    h.receive({ t: "presence", online: ["sam"], inRoom: [] });

    expect(h.serverClock.sampled).toBe(false);
    h.stop();
  });

  it("keeps sampling through the burst", () => {
    const h = harness();
    h.advance(200);
    h.fireTimers();

    expect(h.sent).toHaveLength(2);
    h.stop();
  });

  it("schedules the next burst far out once five samples are taken", () => {
    const h = harness();

    for (let i = 0; i < 4; i += 1) {
      h.advance(200);
      h.fireTimers();
    }

    expect(h.sent).toHaveLength(5);
    // The fifth sample schedules the re-sample, not another burst step.
    expect(h.timers.at(-1)?.ms).toBe(30_000);
    h.stop();
  });

  it("stops sending once stopped", () => {
    const h = harness();
    h.stop();
    h.fireTimers();

    expect(h.sent).toHaveLength(1);
  });
});
