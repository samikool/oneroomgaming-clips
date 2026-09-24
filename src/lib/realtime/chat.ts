/** Longer than anyone types in a theater, short enough not to wreck the panel. */
export const MAX_CHAT_LENGTH = 500;

/**
 * The reactions people may send.
 *
 * A fixed set rather than a free `emoji` string: rendering arbitrary
 * user-supplied text as an "emoji" is an abuse surface for no gain, and six
 * one-tap buttons are better UX than a picker.
 */
export const REACTIONS = ["🔥", "😂", "💀", "🎯", "😮", "👏"] as const;

export function isReaction(value: unknown): value is string {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

export type ChatMessage = { id: string; user: string; text: string; at: number };

/**
 * Cleans a chat message, or returns null if there is nothing to send.
 *
 * Over-long messages are truncated rather than rejected: rejecting silently
 * loses what someone typed, and the composer already shows the limit.
 */
export function normalizeChatText(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  // Collapse every whitespace run, so one message cannot scroll the panel
  // away with newlines.
  const collapsed = raw.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) {
    return null;
  }

  return collapsed.slice(0, MAX_CHAT_LENGTH);
}
