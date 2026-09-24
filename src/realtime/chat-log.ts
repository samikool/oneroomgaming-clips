import type { ChatMessage } from "@/lib/realtime/chat";

/**
 * How many messages a joiner sees.
 *
 * The spec says theater chat is ephemeral and per-clip comments are the
 * persistent thing. A backlog of zero would be the most literal reading, but
 * it means joining mid-conversation shows an empty panel, which reads as
 * broken. Fifty messages in memory, lost on restart exactly like room state.
 */
export const CHAT_BACKLOG = 50;

/** Cooldowns, per user. Fast enough to feel free, slow enough to stop a flood. */
export const CHAT_COOLDOWN_MS = 500;
export const REACTION_COOLDOWN_MS = 400;

export class ChatLog {
  #messages: ChatMessage[] = [];
  #sequence = 0;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  add(user: string, text: string): ChatMessage {
    // The id carries a counter as well as the clock: React keys the list on
    // it, and two messages in the same millisecond sharing an id would make
    // one of them disappear.
    this.#sequence += 1;
    const message: ChatMessage = {
      id: `${this.#now()}-${this.#sequence}`,
      user,
      text,
      at: this.#now(),
    };

    this.#messages = [...this.#messages, message].slice(-CHAT_BACKLOG);
    return message;
  }

  /** A copy: the caller serialises this straight onto the wire. */
  get messages(): ChatMessage[] {
    return [...this.#messages];
  }
}
