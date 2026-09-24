import type { ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { RESAMPLE_INTERVAL_MS, SAMPLE_COUNT, type ServerClock } from "./clock";

/** How long to wait between the five samples of one burst. */
const BURST_GAP_MS = 200;

export type ClockSampler = {
  /** Feed every server message here; it picks out the time.sync replies. */
  receive(message: ServerMessage): void;
  stop(): void;
};

/**
 * Drives the clock handshake: a burst of five samples, then another burst
 * every 30 seconds.
 *
 * Timers are injected rather than reached for, so the whole schedule is
 * testable without waiting 30 real seconds.
 */
export function startClockSampler(options: {
  clock: ServerClock;
  send(message: ClientMessage): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): ClockSampler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  const pending = new Set<number>();
  let remainingInBurst = SAMPLE_COUNT;
  let stopped = false;
  let handle: unknown;

  function sample(): void {
    if (stopped) {
      return;
    }

    const t0 = now();
    pending.add(t0);
    options.send({ t: "time.sync", t0 });
    remainingInBurst -= 1;

    handle =
      remainingInBurst > 0
        ? setTimer(sample, BURST_GAP_MS)
        : setTimer(() => {
            remainingInBurst = SAMPLE_COUNT;
            sample();
          }, RESAMPLE_INTERVAL_MS);
  }

  sample();

  return {
    receive(message) {
      if (message.t !== "time.sync") {
        return;
      }

      // A t0 we never sent — or already consumed — is not ours to trust. It
      // would let a stray frame inject an arbitrary offset.
      if (!pending.delete(message.t0)) {
        return;
      }

      options.clock.record({ t0: message.t0, t1: message.t1, t2: now() });
    },
    stop() {
      stopped = true;
      clearTimer(handle);
    },
  };
}
