import { describe, expect, it } from "bun:test";
import { CHAT_BACKLOG, ChatLog } from "@/realtime/chat-log";

function logAt(start = 1_000) {
  let clock = start;
  return { log: new ChatLog(() => clock), advance: (ms: number) => (clock += ms) };
}

describe("ChatLog", () => {
  it("starts empty", () => {
    expect(new ChatLog().messages).toEqual([]);
  });

  it("stamps a message with the author, the text and the server clock", () => {
    const { log } = logAt(5_000);
    const message = log.add("sam", "gg");

    expect(message).toMatchObject({ user: "sam", text: "gg", at: 5_000 });
    expect(typeof message.id).toBe("string");
    expect(message.id.length).toBeGreaterThan(0);
  });

  it("gives every message a distinct id even within one millisecond", () => {
    // React keys the list on this. Two messages sharing an id would make one
    // of them disappear.
    const { log } = logAt();
    const first = log.add("sam", "a");
    const second = log.add("sam", "b");

    expect(first.id).not.toBe(second.id);
  });

  it("keeps messages in the order they arrived", () => {
    const { log, advance } = logAt();
    log.add("sam", "first");
    advance(10);
    log.add("dave", "second");

    expect(log.messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("keeps only the most recent window", () => {
    const { log } = logAt();

    for (let i = 0; i < CHAT_BACKLOG + 10; i += 1) {
      log.add("sam", `message ${i}`);
    }

    expect(log.messages).toHaveLength(CHAT_BACKLOG);
    expect(log.messages[0].text).toBe("message 10");
  });

  it("hands out a copy, so a caller cannot mutate the log", () => {
    const { log } = logAt();
    log.add("sam", "gg");
    log.messages.push({ id: "x", user: "evil", text: "nope", at: 0 });

    expect(log.messages).toHaveLength(1);
  });
});
