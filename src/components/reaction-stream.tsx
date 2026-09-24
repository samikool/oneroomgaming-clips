"use client";

import type { FloatingReaction } from "@/lib/theater/use-room";

/**
 * Reactions floating up over the video.
 *
 * `pointer-events: none` throughout — this sits on top of the player and must
 * never intercept a click meant for it.
 */
export function ReactionStream({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="reaction-stream" aria-hidden="true">
      {reactions.map((reaction) => (
        <span
          key={reaction.key}
          className="reaction-float"
          style={{ left: `${10 + reaction.lane * 18}%` }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
