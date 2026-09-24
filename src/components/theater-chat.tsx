"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "@/lib/realtime/chat";
import type { ChatMessage } from "@/lib/realtime/envelope";

/**
 * Used twice: as the sidebar tab and inside the fullscreen overlay. Both need
 * the same list and composer, so it takes its messages as a prop rather than
 * calling useRoom itself.
 */
export function TheaterChat({
  messages,
  me,
  onSend,
  compact = false,
}: {
  messages: ChatMessage[];
  me: string;
  onSend(text: string): void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Follow the conversation. There is no scroll-position check: in a room this
  // small, chat that does not follow is chat you miss.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const text = draft.trim();

    if (text.length === 0) {
      return;
    }

    onSend(text);
    setDraft("");
  }

  return (
    <div className={`theater-chat ${compact ? "theater-chat-compact" : ""}`}>
      <ol className="theater-chat-list">
        {messages.length === 0 && <li className="text-sm text-ink-muted">Nothing said yet.</li>}
        {messages.map((message) => (
          <li key={message.id} className="text-sm">
            <span className={message.user === me ? "text-ink" : "text-ink-muted"}>
              {message.user}
            </span>{" "}
            <span className="text-ink">{message.text}</span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
      <form onSubmit={submit} className="theater-chat-form">
        <input
          className="title-input"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something"
          aria-label="Chat message"
          onChange={(event) => setDraft(event.target.value)}
          // Escape is how the browser leaves fullscreen. Without this the
          // input swallows it and people are stuck with no way out but F11.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="submit" className="button-secondary">
          Send
        </button>
      </form>
    </div>
  );
}
