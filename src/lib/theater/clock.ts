/** One round trip: we sent t0, the server stamped t1, we received it at t2. */
export type ClockSample = { t0: number; t1: number; t2: number };

/** How many samples the offset is chosen from. */
export const SAMPLE_COUNT = 5;

/** How often the handshake re-runs. Clocks drift; 30s keeps it honest. */
export const RESAMPLE_INTERVAL_MS = 30_000;

/**
 * Cristian's algorithm — the basis of NTP/SNTP.
 *
 *   offset = ((t1 - t0) + (t1 - t2)) / 2
 *   rtt    = t2 - t0
 *
 * Keep the offset from the LOWEST-RTT sample rather than the median. The
 * algorithm assumes a symmetric round trip, and the shortest round trip is the
 * one least distorted by queuing — a median averages the bad samples in
 * instead of discarding them.
 */
export function offsetFromSamples(samples: ClockSample[]): number {
  let best: ClockSample | null = null;
  let bestRtt = Infinity;

  for (const candidate of samples) {
    const rtt = candidate.t2 - candidate.t0;

    if (rtt < bestRtt) {
      bestRtt = rtt;
      best = candidate;
    }
  }

  if (best === null) {
    return 0;
  }

  return (best.t1 - best.t0 + (best.t1 - best.t2)) / 2;
}

/**
 * The browser's estimate of the server's clock.
 *
 * Everything in the theater is expressed in server time: `anchorServerTime` on
 * the room snapshot, and the target playhead derived from it. This is the one
 * place that converts.
 */
export class ServerClock {
  #samples: ClockSample[] = [];
  #offset = 0;

  record(sample: ClockSample): void {
    this.#samples = [...this.#samples, sample].slice(-SAMPLE_COUNT);
    this.#offset = offsetFromSamples(this.#samples);
  }

  get offset(): number {
    return this.#offset;
  }

  /** False until the first sample lands — the caller may want to wait. */
  get sampled(): boolean {
    return this.#samples.length > 0;
  }

  now(localNow: number): number {
    return localNow + this.#offset;
  }
}
