import { describe, expect, it } from "bun:test";
import type { ChatMessage, ServerMessage } from "@/lib/realtime/envelope";
import { CHAT_VIEW_LIMIT, reduceChat } from "@/lib/theater/chat-store";

const message = (id: string, text: string): ChatMessage => ({ id, user: "sam", text, at: 1 });

describe("reduceChat", () => {
  it("appends a new message", () => {
    const next = reduceChat([], { t: "chat", message: message("1", "hi") });
    expect(next.map((m) => m.text)).toEqual(["hi"]);
  });

  it("replaces everything with a backlog", () => {
    // The backlog arrives on reconnect as well as on first subscribe. Merging
    // it would duplicate every message a client already had.
    const existing = [message("1", "old")];
    const next = reduceChat(existing, {
      t: "chat.backlog",
      messages: [message("1", "old"), message("2", "newer")],
    });

    expect(next.map((m) => m.text)).toEqual(["old", "newer"]);
  });

  it("ignores a message it already has", () => {
    const existing = [message("1", "hi")];
    expect(reduceChat(existing, { t: "chat", message: message("1", "hi") })).toBe(existing);
  });

  it("caps what it keeps in memory", () => {
    let view: ChatMessage[] = [];

    for (let i = 0; i < CHAT_VIEW_LIMIT + 20; i += 1) {
      view = reduceChat(view, { t: "chat", message: message(String(i), `m${i}`) });
    }

    expect(view).toHaveLength(CHAT_VIEW_LIMIT);
    expect(view[view.length - 1].text).toBe(`m${CHAT_VIEW_LIMIT + 19}`);
  });

  it("returns the same array for an unrelated message", () => {
    const existing = [message("1", "hi")];
    const unrelated: ServerMessage = { t: "presence", online: ["sam"], inRoom: [] };
    expect(reduceChat(existing, unrelated)).toBe(existing);
  });
});
