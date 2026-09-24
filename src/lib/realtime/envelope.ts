export const TOPICS = ["grid", "user", "room"] as const;
export type Topic = (typeof TOPICS)[number];

export type ClipSummary = {
  id: string;
  title: string;
  status: string;
  thumbPath: string | null;
  durationMs: number | null;
  /** Milliseconds since the epoch. A Date would arrive as a string over JSON. */
  createdAt: number;
};

/**
 * The room's entire authoritative state. `realtime` owns it; everyone else
 * receives snapshots.
 *
 * It carries the clip's title and duration, not just its id, because
 * `realtime` holds no database connection and cannot resolve one. The host's
 * browser already has both and sends them with `setClip`.
 *
 * `positionMs` is the playhead as of `anchorServerTime`, which the server
 * stamps with its own clock.
 */
export type RoomState = {
  clipId: string | null;
  clipTitle: string | null;
  clipDurationMs: number | null;
  hostUserId: string | null;
  paused: boolean;
  positionMs: number;
  anchorServerTime: number;
  rev: number;
};

export const ROOM_ACTIONS = ["play", "pause", "seek", "setClip"] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

export type ServerMessage =
  | { t: "hello"; username: string; serverTime: number }
  | { t: "time.sync"; t0: number; t1: number }
  | { t: "presence"; online: string[]; inRoom: string[] }
  | { t: "room"; state: RoomState }
  | { t: "room.controlRequested"; user: string }
  | { t: "clip.added"; clip: ClipSummary }
  | { t: "clip.updated"; clip: ClipSummary }
  | { t: "upload.progress"; uploadId: string; pct: number; user: string };

export type ClientMessage =
  | { t: "sub"; topics: Topic[] }
  | { t: "time.sync"; t0: number }
  | { t: "room.join" }
  | { t: "room.leave" }
  | { t: "room.claimHost" }
  | { t: "room.requestControl" }
  | { t: "room.giveControl"; userId: string }
  | {
      t: "room.control";
      action: RoomAction;
      positionMs?: number;
      clipId?: string;
      title?: string;
      durationMs?: number | null;
    };

export function topicFor(message: ServerMessage): Topic {
  switch (message.t) {
    case "hello":
    case "time.sync":
      return "user";
    case "room":
    case "room.controlRequested":
      return "room";
    default:
      return "grid";
  }
}

/**
 * Whether this message may be dropped when a socket is backed up. Progress and
 * presence are re-sent constantly, so losing one costs nothing. Clip lifecycle
 * is not: a client that misses "this clip is ready" never recovers on its own.
 */
export function isEphemeral(message: ServerMessage): boolean {
  return message.t === "upload.progress" || message.t === "presence";
}

function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (TOPICS as readonly string[]).includes(value);
}

function isRoomAction(value: unknown): value is RoomAction {
  return typeof value === "string" && (ROOM_ACTIONS as readonly string[]).includes(value);
}

function parseRoomControl(message: Record<string, unknown>): ClientMessage | null {
  const { action } = message;

  if (!isRoomAction(action)) {
    return null;
  }

  if (action === "setClip") {
    if (typeof message.clipId !== "string" || message.clipId.length === 0) {
      return null;
    }

    return {
      t: "room.control",
      action,
      clipId: message.clipId,
      title: typeof message.title === "string" ? message.title : "",
      durationMs: typeof message.durationMs === "number" ? message.durationMs : null,
    };
  }

  if (action === "seek") {
    // A negative position would make every follower hard-seek to a time that
    // does not exist, so it is rejected rather than clamped.
    return typeof message.positionMs === "number" &&
      Number.isFinite(message.positionMs) &&
      message.positionMs >= 0
      ? { t: "room.control", action, positionMs: message.positionMs }
      : null;
  }

  return { t: "room.control", action };
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message.t === "sub") {
    if (!Array.isArray(message.topics) || !message.topics.every(isTopic)) {
      return null;
    }

    return { t: "sub", topics: message.topics as Topic[] };
  }

  if (message.t === "time.sync" && typeof message.t0 === "number") {
    return { t: "time.sync", t0: message.t0 };
  }

  if (
    message.t === "room.join" ||
    message.t === "room.leave" ||
    message.t === "room.claimHost" ||
    message.t === "room.requestControl"
  ) {
    return { t: message.t };
  }

  if (message.t === "room.giveControl") {
    return typeof message.userId === "string" && message.userId.length > 0
      ? { t: "room.giveControl", userId: message.userId }
      : null;
  }

  if (message.t === "room.control") {
    return parseRoomControl(message);
  }

  return null;
}
