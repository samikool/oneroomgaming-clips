import type { ChatMessage, ServerMessage } from "@/lib/realtime/envelope";

/** How much scrollback a browser keeps. Larger than the server's backlog. */
export const CHAT_VIEW_LIMIT = 200;

/**
 * Folds chat traffic into the browser's message list.
 *
 * Returns the SAME array when nothing changed, so a component reading it does
 * not re-render on every unrelated room snapshot.
 */
export function reduceChat(messages: ChatMessage[], message: ServerMessage): ChatMessage[] {
  if (message.t === "chat.backlog") {
    // Replace rather than merge. The backlog arrives on every reconnect, and
    // merging would duplicate everything the client already had.
    return message.messages.slice(-CHAT_VIEW_LIMIT);
  }

  if (message.t === "chat") {
    if (messages.some((existing) => existing.id === message.message.id)) {
      return messages;
    }

    return [...messages, message.message].slice(-CHAT_VIEW_LIMIT);
  }

  return messages;
}
