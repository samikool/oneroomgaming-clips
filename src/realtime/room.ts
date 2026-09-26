import type { ClientMessage, QueueEntry, RoomQueueCommand, RoomState } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE, positionNow } from "@/lib/realtime/room-state";
import { RateLimiter } from "./rate-limit";

export type RoomControl = Extract<ClientMessage, { t: "room.control" }>;

/**
 * How long a user must wait before asking for control again. Requests are not
 * queued or persisted — an ignored one simply expires from the host's UI — so
 * the only thing stopping a frustrated clicker from filling the host's screen
 * is this.
 */
export const REQUEST_CONTROL_COOLDOWN_MS = 10_000;

/**
 * Plenty for an evening, and the only brake on adding: there is deliberately no
 * per-person cooldown, because a friend queueing three clips in a second is the
 * normal case, not abuse.
 */
export const QUEUE_LIMIT = 50;

/**
 * The room. There is exactly one, it lives in memory, and it is the sole
 * authority on what is playing and who may change it.
 *
 * It holds no database connection and performs no I/O: every mutator is a
 * synchronous state transition against an injected clock. That is what makes
 * the whole host model testable without a socket, and what keeps the realtime
 * process non-blocking.
 *
 * State is deliberately lost on restart. A room is a thing people are in right
 * now; persisting one would mean restoring a playhead nobody is watching.
 */
export class Room {
  #state: RoomState = { ...INITIAL_ROOM_STATE };
  readonly #members = new Set<string>();
  readonly #requestLimiter: RateLimiter;
  readonly #now: () => number;
  #nextEntry = 1;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#requestLimiter = new RateLimiter(REQUEST_CONTROL_COOLDOWN_MS, now);
  }

  get state(): RoomState {
    return this.#state;
  }

  get members(): string[] {
    return [...this.#members];
  }

  #commit(next: Partial<RoomState>): true {
    this.#state = { ...this.#state, ...next, rev: this.#state.rev + 1 };
    return true;
  }

  /** The playhead frozen where it actually is, as of now. */
  #frozen(): Pick<RoomState, "positionMs" | "anchorServerTime"> {
    const now = this.#now();
    return { positionMs: positionNow(this.#state, now), anchorServerTime: now };
  }

  join(user: string): boolean {
    if (this.#members.has(user)) {
      return false;
    }

    this.#members.add(user);

    // First person in takes the chair. Everyone else follows.
    //
    // rev still moves when only membership changed: membership rides on
    // presence rather than on the state, but clients apply both from the same
    // ordered stream and a stalled rev would make the pair look inconsistent.
    return this.#commit(this.#state.hostUserId === null ? { hostUserId: user } : {});
  }

  leave(user: string): boolean {
    if (!this.#members.delete(user)) {
      return false;
    }

    // An empty room forgets its queue, so the next session does not open on
    // last night's leftovers.
    const queue = this.#members.size === 0 ? { queue: [] } : {};

    if (this.#state.hostUserId !== user) {
      return this.#commit(queue);
    }

    // The room does not auto-promote: it goes hostless and pauses where it is,
    // and someone present claims it deliberately.
    return this.#commit({ ...queue, ...this.#frozen(), hostUserId: null, paused: true });
  }

  claimHost(user: string): boolean {
    if (this.#state.hostUserId !== null || !this.#members.has(user)) {
      return false;
    }

    return this.#commit({ hostUserId: user });
  }

  giveControl(from: string, to: string): boolean {
    if (this.#state.hostUserId !== from || !this.#members.has(to) || from === to) {
      return false;
    }

    // Immediate, with no accept prompt. Among friends a surprise promotion is
    // funny, and an accept round-trip adds a pending state for no gain.
    return this.#commit({ hostUserId: to });
  }

  control(user: string, command: RoomControl): boolean {
    // The single enforcement point. The client disables controls for UX; this
    // is what actually stops a follower.
    if (this.#state.hostUserId !== user) {
      return false;
    }

    const now = this.#now();

    switch (command.action) {
      case "setClip":
        return this.#commit(
          this.#starting(command.clipId ?? null, command.title ?? "", command.durationMs ?? null),
        );

      case "pause":
        return this.#state.paused ? false : this.#commit({ ...this.#frozen(), paused: true });

      case "play":
        if (!this.#state.paused || this.#state.clipId === null) {
          return false;
        }

        // Resume from where it froze, re-anchored to now.
        return this.#commit({ anchorServerTime: now, paused: false });

      case "seek":
        // Re-anchoring is not optional: leave the old anchor in place and
        // every follower adds the time since it on top of the new position.
        return this.#commit({ positionMs: command.positionMs ?? 0, anchorServerTime: now });
    }
  }

  /** A clip starting from the top, playing, anchored to now. */
  #starting(clipId: string | null, title: string, durationMs: number | null): Partial<RoomState> {
    return {
      clipId,
      clipTitle: title,
      clipDurationMs: durationMs,
      positionMs: 0,
      anchorServerTime: this.#now(),
      paused: false,
    };
  }

  #playEntry(entry: QueueEntry | undefined): boolean {
    if (!entry) {
      return false;
    }

    return this.#commit({
      ...this.#starting(entry.clipId, entry.title, entry.durationMs),
      queue: this.#state.queue.filter((e) => e.entryId !== entry.entryId),
    });
  }

  queue(user: string, command: RoomQueueCommand): boolean {
    const { queue } = this.#state;

    if (command.op === "add") {
      if (!this.#members.has(user) || queue.length >= QUEUE_LIMIT) {
        return false;
      }

      const entry: QueueEntry = {
        entryId: `q${this.#nextEntry++}`,
        clipId: command.clipId,
        title: command.title,
        durationMs: command.durationMs,
        addedBy: user,
      };

      return this.#commit({ queue: [...queue, entry] });
    }

    // Everything but adding belongs to whoever is running the room.
    if (this.#state.hostUserId !== user) {
      return false;
    }

    switch (command.op) {
      case "clear":
        return queue.length === 0 ? false : this.#commit({ queue: [] });

      case "playNext":
        return this.#playEntry(queue[0]);

      case "play":
        return this.#playEntry(queue.find((e) => e.entryId === command.entryId));

      case "remove": {
        const next = queue.filter((e) => e.entryId !== command.entryId);
        return next.length === queue.length ? false : this.#commit({ queue: next });
      }

      case "move": {
        const from = queue.findIndex((e) => e.entryId === command.entryId);
        const to = from + command.delta;

        if (from === -1 || to < 0 || to >= queue.length) {
          return false;
        }

        const next = [...queue];
        [next[from], next[to]] = [next[to], next[from]];
        return this.#commit({ queue: next });
      }

      case "moveTo": {
        const from = queue.findIndex((e) => e.entryId === command.entryId);
        const to = command.toIndex;

        if (from === -1 || to === from || to >= queue.length) {
          return false;
        }

        const next = queue.filter((_, i) => i !== from);
        next.splice(to, 0, queue[from]);
        return this.#commit({ queue: next });
      }
    }
  }

  /**
   * Clears what is playing if it is the clip that was just deleted, drops the
   * clip from the queue, and reports whether anything changed so the caller
   * knows to republish.
   *
   * Takes only an id because that is all `clip.removed` carries, and this
   * process has no database to resolve one against.
   *
   * Members and the host are left alone: a clip being deleted is not a reason
   * to throw everyone out of the room or unseat whoever is running it. They
   * land on an empty theater and can pick something else.
   */
  clearIfClip(clipId: string): boolean {
    const queue = this.#state.queue.filter((e) => e.clipId !== clipId);
    const queueChanged = queue.length !== this.#state.queue.length;

    if (this.#state.clipId !== clipId) {
      return queueChanged ? this.#commit({ queue }) : false;
    }

    return this.#commit({
      queue,
      clipId: null,
      clipTitle: null,
      clipDurationMs: null,
      positionMs: 0,
      anchorServerTime: this.#now(),
      paused: true,
    });
  }

  /**
   * Returns the host to notify, or null when there is nobody to ask, the asker
   * is the host or not present, or they are inside the cooldown.
   */
  requestControl(user: string): string | null {
    const host = this.#state.hostUserId;

    if (host === null || host === user || !this.#members.has(user)) {
      return null;
    }

    return this.#requestLimiter.take(user) ? host : null;
  }
}
