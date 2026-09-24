/**
 * A per-key cooldown.
 *
 * Extracted from `Room`, which grew one of these inline for control requests
 * and now shares it with chat and reactions. No I/O, injected clock.
 */
export class RateLimiter {
  readonly #last = new Map<string, number>();
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(cooldownMs: number, now: () => number = Date.now) {
    this.#cooldownMs = cooldownMs;
    this.#now = now;
  }

  /** True when the caller may proceed, and only then is the clock recorded. */
  take(key: string): boolean {
    const now = this.#now();
    const last = this.#last.get(key);

    if (last !== undefined && now - last < this.#cooldownMs) {
      // Deliberately does NOT record. Recording a refused attempt would
      // extend the cooldown every time someone double-clicks, locking them
      // out for as long as they keep trying.
      return false;
    }

    this.#last.set(key, now);
    return true;
  }
}
