import { isReaction, normalizeChatText, type ChatMessage } from "./chat";

export type { ChatMessage } from "./chat";

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
  /**
   * Filled on the server-rendered path only. A live `clip.added` has no join
   * available, and a brand new clip has neither an uploader chip nor a game
   * worth showing, so both are optional rather than nullable-required.
   */
  uploader?: string | null;
  game?: { name: string; slug: string } | null;
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
/**
 * One clip waiting its turn. `entryId` is issued by `realtime` so the same clip
 * queued twice can still be removed or moved one copy at a time. Title and
 * duration come from whoever added it, for the same reason `setClip` carries
 * them: `realtime` has no database. The thumbnail is not carried at all — each
 * browser looks it up by `clipId`, so nobody can put a URL on everyone's page.
 */
export type QueueEntry = {
  entryId: string;
  clipId: string;
  title: string;
  durationMs: number | null;
  addedBy: string;
};

export type RoomState = {
  clipId: string | null;
  clipTitle: string | null;
  clipDurationMs: number | null;
  hostUserId: string | null;
  paused: boolean;
  positionMs: number;
  anchorServerTime: number;
  /** Up next, in order. Never advances on its own: the host plays each one. */
  queue: QueueEntry[];
  rev: number;
};

/** A comment as it travels on the wire. `user` is the Authentik username. */
export type CommentSummary = {
  id: string;
  clipId: string;
  user: string;
  body: string;
  /** Milliseconds since the epoch. A Date would arrive as a string over JSON. */
  at: number;
  deleted: boolean;
};

export const ROOM_ACTIONS = ["play", "pause", "seek", "setClip"] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

export type ServerMessage =
  | { t: "hello"; username: string; serverTime: number }
  | { t: "time.sync"; t0: number; t1: number }
  | { t: "presence"; online: string[]; inRoom: string[] }
  | { t: "room"; state: RoomState }
  | { t: "room.controlRequested"; user: string }
  | { t: "chat"; message: ChatMessage }
  | { t: "chat.backlog"; messages: ChatMessage[] }
  | { t: "reaction"; user: string; emoji: string; at: number }
  | { t: "comment.added"; comment: CommentSummary }
  | { t: "clip.added"; clip: ClipSummary }
  | { t: "clip.updated"; clip: ClipSummary }
  // Carries only the id: by the time this is published the row is gone, so
  // there is no clip left to summarise.
  | { t: "clip.removed"; clipId: string }
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
    }
  | RoomQueueCommand
  | { t: "chat.send"; text: string }
  | { t: "reaction.send"; emoji: string };

/**
 * Edits to the queue. `add` is open to anyone in the room; everything else is
 * the host's. `realtime` enforces both.
 */
export type RoomQueueCommand =
  | { t: "room.queue"; op: "add"; clipId: string; title: string; durationMs: number | null }
  | { t: "room.queue"; op: "remove" | "play"; entryId: string }
  | { t: "room.queue"; op: "move"; entryId: string; delta: -1 | 1 }
  /** Drag and drop: `toIndex` is where the entry ends up. */
  | { t: "room.queue"; op: "moveTo"; entryId: string; toIndex: number }
  | { t: "room.queue"; op: "clear" | "playNext" };

/**
 * Which topics a message belongs to.
 *
 * Almost everything belongs to exactly one. `presence` belongs to two: the
 * grid shows who is on the site, and the theater shows who is in the room, and
 * both facts travel in the same message. Routing it to one topic would leave
 * the other surface blind.
 */
export function topicsFor(message: ServerMessage): Topic[] {
  switch (message.t) {
    case "hello":
    case "time.sync":
      return ["user"];
    case "presence":
      return ["grid", "room"];
    case "room":
    case "room.controlRequested":
    case "chat":
    case "chat.backlog":
    case "reaction":
      return ["room"];
    // comment.added falls through to grid on purpose: topics are a fixed
    // enum, and the browser filters by clipId.
    default:
      return ["grid"];
  }
}

/**
 * Whether this message may be dropped when a socket is backed up. Progress and
 * presence are re-sent constantly, so losing one costs nothing. Clip lifecycle
 * is not: a client that misses "this clip is ready" never recovers on its own.
 */
export function isEphemeral(message: ServerMessage): boolean {
  return (
    message.t === "upload.progress" || message.t === "presence" || message.t === "reaction"
  );
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

/** Titles are relayed to everyone in the room, so a runaway one is cut short. */
const QUEUE_TITLE_MAX = 200;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseRoomQueue(message: Record<string, unknown>): RoomQueueCommand | null {
  switch (message.op) {
    case "add":
      return nonEmptyString(message.clipId)
        ? {
            t: "room.queue",
            op: "add",
            clipId: message.clipId,
            title: typeof message.title === "string" ? message.title.slice(0, QUEUE_TITLE_MAX) : "",
            durationMs: typeof message.durationMs === "number" ? message.durationMs : null,
          }
        : null;

    case "remove":
    case "play":
      return nonEmptyString(message.entryId)
        ? { t: "room.queue", op: message.op, entryId: message.entryId }
        : null;

    case "move":
      return nonEmptyString(message.entryId) && (message.delta === -1 || message.delta === 1)
        ? { t: "room.queue", op: "move", entryId: message.entryId, delta: message.delta }
        : null;

    case "moveTo":
      return nonEmptyString(message.entryId) &&
        Number.isInteger(message.toIndex) &&
        (message.toIndex as number) >= 0
        ? { t: "room.queue", op: "moveTo", entryId: message.entryId, toIndex: message.toIndex as number }
        : null;

    case "clear":
    case "playNext":
      return { t: "room.queue", op: message.op };

    default:
      return null;
  }
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

  if (message.t === "room.queue") {
    return parseRoomQueue(message);
  }

  if (message.t === "chat.send") {
    const text = normalizeChatText(message.text);
    return text === null ? null : { t: "chat.send", text };
  }

  if (message.t === "reaction.send") {
    return isReaction(message.emoji) ? { t: "reaction.send", emoji: message.emoji } : null;
  }

  return null;
}
