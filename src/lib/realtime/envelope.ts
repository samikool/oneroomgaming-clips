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

export type ServerMessage =
  | { t: "hello"; username: string; serverTime: number }
  | { t: "time.sync"; t0: number; t1: number }
  | { t: "presence"; online: string[] }
  | { t: "clip.added"; clip: ClipSummary }
  | { t: "clip.updated"; clip: ClipSummary }
  | { t: "upload.progress"; uploadId: string; pct: number; user: string };

export type ClientMessage =
  | { t: "sub"; topics: Topic[] }
  | { t: "time.sync"; t0: number };

export function topicFor(message: ServerMessage): Topic {
  switch (message.t) {
    case "hello":
    case "time.sync":
      return "user";
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

  return null;
}
