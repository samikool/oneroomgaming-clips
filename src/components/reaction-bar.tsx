"use client";

import { REACTIONS } from "@/lib/realtime/chat";

export function ReactionBar({ onReact }: { onReact(emoji: string): void }) {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-button"
          aria-label={`React with ${emoji}`}
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
