import type { ReportedEvent } from "@/lib/realtime/envelope";

const BODY_MAX = 500;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function clipIdOrNull(value: unknown): value is string | null {
  return value === null || nonEmpty(value);
}

/** A strict shape check of what realtime reports. Null for anything else. */
export function parseReportedEvent(body: unknown): ReportedEvent | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const e = body as Record<string, unknown>;
  if (!nonEmpty(e.user) || typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  const { user, at } = e;

  switch (e.kind) {
    case "theater.play":
      return nonEmpty(e.clipId) ? { kind: "theater.play", user, clipId: e.clipId, at } : null;
    case "theater.reaction":
      return clipIdOrNull(e.clipId) && nonEmpty(e.emoji)
        ? { kind: "theater.reaction", user, clipId: e.clipId, emoji: e.emoji, at }
        : null;
    case "theater.chat":
      return clipIdOrNull(e.clipId) && typeof e.body === "string" && e.body.length <= BODY_MAX
        ? { kind: "theater.chat", user, clipId: e.clipId, body: e.body, at }
        : null;
    default:
      return null;
  }
}
