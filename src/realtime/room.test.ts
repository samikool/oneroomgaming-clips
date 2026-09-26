import { describe, expect, it } from "bun:test";
import {
  QUEUE_LIMIT,
  REQUEST_CONTROL_COOLDOWN_MS,
  Room,
} from "@/realtime/room";

function roomAt(start = 1_000) {
  let clock = start;
  const room = new Room(() => clock);
  // `now` is a function, not a getter: destructuring a getter snapshots it at
  // destructure time, which silently reads the clock before any advance().
  return { room, advance: (ms: number) => (clock += ms), now: () => clock };
}

const setAce = {
  t: "room.control",
  action: "setClip",
  clipId: "01A",
  title: "ace",
  durationMs: 30_000,
} as const;

describe("Room — membership and host", () => {
  it("starts empty, hostless and paused", () => {
    const { room } = roomAt();
    expect(room.members).toEqual([]);
    expect(room.state.hostUserId).toBeNull();
    expect(room.state.paused).toBe(true);
  });

  it("makes the first person in the host", () => {
    const { room } = roomAt();
    expect(room.join("sam")).toBe(true);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("does not promote the second person", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    expect(room.state.hostUserId).toBe("sam");
    expect(room.members.sort()).toEqual(["dave", "sam"]);
  });

  it("reports no change when someone joins twice", () => {
    const { room } = roomAt();
    room.join("sam");
    expect(room.join("sam")).toBe(false);
  });

  it("bumps rev on every change that happened", () => {
    const { room } = roomAt();
    room.join("sam");
    const first = room.state.rev;
    room.join("dave");
    expect(room.state.rev).toBeGreaterThan(first);
  });

  it("does not bump rev on a no-op", () => {
    const { room } = roomAt();
    room.join("sam");
    const rev = room.state.rev;
    room.join("sam");
    expect(room.state.rev).toBe(rev);
  });
});

describe("Room — the host leaving", () => {
  it("goes hostless and pauses rather than auto-promoting", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);

    expect(room.leave("sam")).toBe(true);
    expect(room.state.hostUserId).toBeNull();
    expect(room.state.paused).toBe(true);
    expect(room.members).toEqual(["dave"]);
  });

  it("freezes the playhead where it actually was when the host left", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(4_000);

    room.leave("sam");
    expect(room.state.positionMs).toBe(4_000);
  });

  it("lets anyone present claim the empty chair", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.leave("sam");

    expect(room.claimHost("dave")).toBe(true);
    expect(room.state.hostUserId).toBe("dave");
  });

  it("refuses a claim while there is a host", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.claimHost("dave")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("refuses a claim from someone who is not in the room", () => {
    // Otherwise anyone holding a socket on the grid could seize a hostless
    // room without ever joining it.
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");

    expect(room.claimHost("stranger")).toBe(false);
    expect(room.state.hostUserId).toBeNull();
  });

  it("leaves the host and playback alone when a follower goes", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);

    expect(room.leave("dave")).toBe(true);
    expect(room.state.hostUserId).toBe("sam");
    expect(room.state.paused).toBe(false);
  });

  it("reports no change when someone who was never in leaves", () => {
    const { room } = roomAt();
    expect(room.leave("ghost")).toBe(false);
  });
});

describe("Room — handoff", () => {
  it("hands control over immediately, with no accept step", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.giveControl("sam", "dave")).toBe(true);
    expect(room.state.hostUserId).toBe("dave");
  });

  it("ignores a handoff from someone who is not the host", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.giveControl("dave", "dave")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("ignores a handoff to someone who is not in the room", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.giveControl("sam", "ghost")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("does not pause when control changes hands mid-playback", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);
    advance(2_000);
    room.giveControl("sam", "dave");

    expect(room.state.paused).toBe(false);
  });
});

describe("Room — control authorization", () => {
  it("drops a follower's control command silently", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);
    const rev = room.state.rev;

    expect(room.control("dave", { t: "room.control", action: "pause" })).toBe(false);
    expect(room.state.paused).toBe(false);
    expect(room.state.rev).toBe(rev);
  });

  it("drops a control command while the room is hostless", () => {
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");
    room.join("dave");

    expect(room.control("dave", { t: "room.control", action: "play" })).toBe(false);
  });
});

describe("Room — transport", () => {
  it("starts a clip at zero and playing", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);

    expect(room.state).toMatchObject({
      clipId: "01A",
      clipTitle: "ace",
      clipDurationMs: 30_000,
      positionMs: 0,
      paused: false,
    });
  });

  it("stamps the anchor with the server's own clock", () => {
    const { room, now } = roomAt(5_555);
    room.join("sam");
    room.control("sam", setAce);

    expect(room.state.anchorServerTime).toBe(now());
  });

  it("freezes the real playhead on pause", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_500);
    room.control("sam", { t: "room.control", action: "pause" });

    expect(room.state.positionMs).toBe(3_500);
    expect(room.state.paused).toBe(true);
  });

  it("resumes from where it paused, not from where the clock is", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_000);
    room.control("sam", { t: "room.control", action: "pause" });
    advance(60_000);
    room.control("sam", { t: "room.control", action: "play" });

    expect(room.state.positionMs).toBe(3_000);
    expect(room.state.paused).toBe(false);
  });

  it("re-anchors on seek so followers do not double-count the elapsed time", () => {
    const { room, advance, now } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_000);
    room.control("sam", { t: "room.control", action: "seek", positionMs: 12_000 });

    expect(room.state.positionMs).toBe(12_000);
    expect(room.state.anchorServerTime).toBe(now());
  });

  it("keeps a seek while paused paused", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    room.control("sam", { t: "room.control", action: "pause" });
    room.control("sam", { t: "room.control", action: "seek", positionMs: 8_000 });

    expect(room.state.paused).toBe(true);
    expect(room.state.positionMs).toBe(8_000);
  });

  it("reports no change for a play that is already playing", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);

    expect(room.control("sam", { t: "room.control", action: "play" })).toBe(false);
  });

  it("reports no change for a play with no clip loaded", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.control("sam", { t: "room.control", action: "play" })).toBe(false);
  });
});

describe("Room — requesting control", () => {
  it("names the host to notify", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.requestControl("dave")).toBe("sam");
  });

  it("returns null when there is no host to ask", () => {
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");
    room.join("dave");

    expect(room.requestControl("dave")).toBeNull();
  });

  it("returns null when the host asks itself", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.requestControl("sam")).toBeNull();
  });

  it("returns null for someone who is not in the room", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.requestControl("stranger")).toBeNull();
  });

  it("rate-limits a second request inside the cooldown", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.requestControl("dave");
    advance(REQUEST_CONTROL_COOLDOWN_MS - 1);

    expect(room.requestControl("dave")).toBeNull();
  });

  it("allows another request once the cooldown has passed", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.requestControl("dave");
    advance(REQUEST_CONTROL_COOLDOWN_MS);

    expect(room.requestControl("dave")).toBe("sam");
  });

  it("rate-limits per user, not globally", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.join("kai");
    room.requestControl("dave");

    expect(room.requestControl("kai")).toBe("sam");
  });
});

describe("Room — a clip deleted out from under the room", () => {
  function playingAce() {
    const h = roomAt();
    h.room.join("sam");
    h.room.claimHost("sam");
    h.room.control("sam", setAce);
    return h;
  }

  it("clears the room when the clip being watched is deleted", () => {
    const { room } = playingAce();

    expect(room.clearIfClip("01A")).toBe(true);
    expect(room.state.clipId).toBeNull();
    expect(room.state.clipTitle).toBeNull();
    expect(room.state.clipDurationMs).toBeNull();
  });

  it("parks the playhead at zero and pauses, so nobody chases a missing video", () => {
    const { room, advance } = playingAce();
    advance(5_000);

    room.clearIfClip("01A");

    expect(room.state.positionMs).toBe(0);
    expect(room.state.paused).toBe(true);
  });

  // Followers act on rev; without a bump they would ignore the reset.
  it("bumps rev so followers apply the reset", () => {
    const { room } = playingAce();
    const before = room.state.rev;

    room.clearIfClip("01A");

    expect(room.state.rev).toBe(before + 1);
  });

  it("ignores a different clip being deleted", () => {
    const { room } = playingAce();
    const before = room.state.rev;

    expect(room.clearIfClip("01OTHER")).toBe(false);
    expect(room.state.clipId).toBe("01A");
    expect(room.state.rev).toBe(before);
  });

  it("ignores a deletion when the room is not playing anything", () => {
    const { room } = roomAt();

    expect(room.clearIfClip("01A")).toBe(false);
    expect(room.state.rev).toBe(0);
  });

  // Deleting a clip is not a reason to throw everyone out or unseat the host.
  it("keeps members and the host in place", () => {
    const { room } = playingAce();
    room.join("dave");

    room.clearIfClip("01A");

    expect(room.state.hostUserId).toBe("sam");
    expect(room.members.sort()).toEqual(["dave", "sam"]);
  });
});

describe("Room — queue", () => {
  const add = (clipId: string, title = clipId) =>
    ({ t: "room.queue", op: "add", clipId, title, durationMs: 10_000 }) as const;

  function busyRoom() {
    const r = roomAt();
    r.room.join("sam");
    r.room.join("dave");
    return r;
  }

  it("starts empty", () => {
    expect(roomAt().room.state.queue).toEqual([]);
  });

  it("lets any member add, recording who added it", () => {
    const { room } = busyRoom();
    expect(room.queue("dave", add("01A", "ace"))).toBe(true);
    expect(room.state.queue).toEqual([
      expect.objectContaining({ clipId: "01A", title: "ace", durationMs: 10_000, addedBy: "dave" }),
    ]);
  });

  it("refuses an add from someone not in the room", () => {
    const { room } = busyRoom();
    expect(room.queue("mike", add("01A"))).toBe(false);
    expect(room.state.queue).toEqual([]);
  });

  it("allows duplicates, each with its own entry id", () => {
    const { room, advance } = busyRoom();
    room.queue("dave", add("01A"));
    room.queue("dave", add("01A"));
    const [a, b] = room.state.queue;
    expect(a.clipId).toBe(b.clipId);
    expect(a.entryId).not.toBe(b.entryId);
  });

  // Gamers click fast: a second add straight after the first must land.
  it("lets one person add back to back", () => {
    const { room } = busyRoom();
    expect(room.queue("dave", add("01A"))).toBe(true);
    expect(room.queue("dave", add("01B"))).toBe(true);
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01A", "01B"]);
  });

  it(`stops at ${QUEUE_LIMIT} entries`, () => {
    const { room, advance } = busyRoom();
    for (let i = 0; i < QUEUE_LIMIT; i++) {
      room.queue("sam", add(`c${i}`));
      }
    expect(room.queue("sam", add("one-too-many"))).toBe(false);
    expect(room.state.queue).toHaveLength(QUEUE_LIMIT);
  });

  it("lets only the host remove, move and clear", () => {
    const { room, advance } = busyRoom();
    room.queue("dave", add("01A"));
    room.queue("dave", add("01B"));
    const [a] = room.state.queue;

    expect(room.queue("dave", { t: "room.queue", op: "remove", entryId: a.entryId })).toBe(false);
    expect(room.queue("dave", { t: "room.queue", op: "move", entryId: a.entryId, delta: 1 })).toBe(false);
    expect(room.queue("dave", { t: "room.queue", op: "clear" })).toBe(false);
    expect(room.state.queue).toHaveLength(2);
  });

  it("removes one entry by id, leaving its duplicate", () => {
    const { room, advance } = busyRoom();
    room.queue("sam", add("01A"));
    room.queue("sam", add("01A"));
    const [first, second] = room.state.queue;

    expect(room.queue("sam", { t: "room.queue", op: "remove", entryId: first.entryId })).toBe(true);
    expect(room.state.queue.map((e) => e.entryId)).toEqual([second.entryId]);
  });

  it("moves an entry one place, and refuses to move past either end", () => {
    const { room, advance } = busyRoom();
    for (const id of ["01A", "01B", "01C"]) {
      room.queue("sam", add(id));
      }
    const [a, , c] = room.state.queue;

    expect(room.queue("sam", { t: "room.queue", op: "move", entryId: a.entryId, delta: 1 })).toBe(true);
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01B", "01A", "01C"]);
    expect(room.queue("sam", { t: "room.queue", op: "move", entryId: c.entryId, delta: 1 })).toBe(false);
    expect(room.queue("sam", { t: "room.queue", op: "move", entryId: "nope", delta: -1 })).toBe(false);
  });

  it("moves an entry straight to a new position, host only", () => {
    const { room } = busyRoom();
    for (const id of ["01A", "01B", "01C", "01D"]) {
      room.queue("sam", add(id));
    }
    const d = room.state.queue[3];

    expect(room.queue("dave", { t: "room.queue", op: "moveTo", entryId: d.entryId, toIndex: 0 })).toBe(false);
    expect(room.queue("sam", { t: "room.queue", op: "moveTo", entryId: d.entryId, toIndex: 1 })).toBe(true);
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01A", "01D", "01B", "01C"]);
  });

  it("refuses a move to where it already is, past the end, or of an unknown entry", () => {
    const { room } = busyRoom();
    room.queue("sam", add("01A"));
    room.queue("sam", add("01B"));
    const a = room.state.queue[0];
    const rev = room.state.rev;

    expect(room.queue("sam", { t: "room.queue", op: "moveTo", entryId: a.entryId, toIndex: 0 })).toBe(false);
    expect(room.queue("sam", { t: "room.queue", op: "moveTo", entryId: a.entryId, toIndex: 2 })).toBe(false);
    expect(room.queue("sam", { t: "room.queue", op: "moveTo", entryId: "nope", toIndex: 0 })).toBe(false);
    expect(room.state.rev).toBe(rev);
  });

  it("clears the queue", () => {
    const { room } = busyRoom();
    room.queue("dave", add("01A"));
    expect(room.queue("sam", { t: "room.queue", op: "clear" })).toBe(true);
    expect(room.state.queue).toEqual([]);
  });

  it("plays the next entry from the start, playing, and takes it off the queue", () => {
    const { room, advance, now } = busyRoom();
    room.queue("dave", add("01A", "ace"));
    room.queue("dave", add("01B", "bee"));

    expect(room.queue("sam", { t: "room.queue", op: "playNext" })).toBe(true);
    expect(room.state).toMatchObject({
      clipId: "01A",
      clipTitle: "ace",
      clipDurationMs: 10_000,
      positionMs: 0,
      anchorServerTime: now(),
      paused: false,
    });
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01B"]);
  });

  it("does not play next from an empty queue, or for a follower", () => {
    const { room } = busyRoom();
    expect(room.queue("sam", { t: "room.queue", op: "playNext" })).toBe(false);
    room.queue("dave", add("01A"));
    expect(room.queue("dave", { t: "room.queue", op: "playNext" })).toBe(false);
    expect(room.state.clipId).toBeNull();
  });

  it("plays a chosen entry out of order", () => {
    const { room, advance } = busyRoom();
    room.queue("dave", add("01A"));
    room.queue("dave", add("01B"));
    const b = room.state.queue[1];

    expect(room.queue("sam", { t: "room.queue", op: "play", entryId: b.entryId })).toBe(true);
    expect(room.state.clipId).toBe("01B");
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01A"]);
  });

  it("leaves the queue alone when the host plays a clip directly", () => {
    const { room } = busyRoom();
    room.queue("dave", add("01A"));
    room.control("sam", setAce);
    expect(room.state.queue).toHaveLength(1);
  });

  it("drops a deleted clip's entries, even when it is not playing", () => {
    const { room, advance } = busyRoom();
    room.queue("dave", add("01A"));
    room.queue("dave", add("01B"));
    room.queue("dave", add("01A"));

    expect(room.clearIfClip("01A")).toBe(true);
    expect(room.state.queue.map((e) => e.clipId)).toEqual(["01B"]);
    expect(room.clearIfClip("zzz")).toBe(false);
  });

  it("keeps the queue when control changes hands", () => {
    const { room } = busyRoom();
    room.queue("dave", add("01A"));
    room.giveControl("sam", "dave");
    expect(room.state.queue).toHaveLength(1);
  });

  it("empties the queue when the last person leaves", () => {
    const { room } = busyRoom();
    room.queue("dave", add("01A"));
    room.leave("sam");
    expect(room.state.queue).toHaveLength(1);
    room.leave("dave");
    expect(room.state.queue).toEqual([]);
  });
});
