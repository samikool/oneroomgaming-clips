"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LikersPopover } from "./likers-popover";
import { useProfile } from "./profiles-provider";
import { ACCENTS } from "@/lib/profiles/palette";
import { useRealtime } from "@/lib/realtime/use-realtime";

/**
 * A heart and a count. Optimistic: flips at once, then settles on the
 * server's count, or rolls back with a short error. The count opens the list
 * of who liked it.
 *
 * `compact` is the clip-card size. Clicks never bubble, so a heart on a card
 * doesn't open the card.
 */
export function LikeButton({
  clipId,
  me,
  initialCount,
  initialLiked,
  isOwn,
  compact = false,
}: {
  clipId: string;
  me: string;
  initialCount: number;
  initialLiked: boolean;
  isOwn: boolean;
  compact?: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(initialLiked);
  const [error, setError] = useState<string | null>(null);
  const [showLikers, setShowLikers] = useState(false);
  const pending = useRef(false);
  const wrapper = useRef<HTMLSpanElement | null>(null);
  const accent = ACCENTS[useProfile(me).accent];

  useRealtime(["grid"], (message) => {
    if (message.t === "clip.likes" && message.clipId === clipId) setCount(message.count);
  });

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3_000);
    return () => clearTimeout(timer);
  }, [error]);

  async function toggle(event: React.MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    // One request at a time: a double click is one like, not a like and an unlike.
    if (isOwn || pending.current) return;
    pending.current = true;

    const next = !liked;
    const before = { count, liked };
    setLiked(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));

    try {
      const response = await fetch(`/api/clips/${clipId}/like`, { method: next ? "POST" : "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { count: number; liked: boolean };
      setCount(data.count);
      setLiked(data.liked);
    } catch {
      setLiked(before.liked);
      setCount(before.count);
      setError(next ? "Couldn't like that" : "Couldn't unlike that");
    } finally {
      pending.current = false;
    }
  }

  const close = useCallback(() => setShowLikers(false), []);

  return (
    <span ref={wrapper} className={`like${compact ? " like-compact" : ""}`}>
      <button
        type="button"
        className="like-heart"
        aria-pressed={liked}
        aria-label={isOwn ? "can't like your own clip" : liked ? "Unlike" : "Like"}
        title={isOwn ? "can't like your own clip" : undefined}
        disabled={isOwn}
        onClick={toggle}
        style={liked ? { color: accent } : undefined}
      >
        <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
      </button>
      <button
        type="button"
        className="like-count"
        aria-label={`${count} ${count === 1 ? "like" : "likes"}, see who`}
        aria-expanded={showLikers}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setShowLikers((open) => !open);
        }}
      >
        {count}
      </button>
      {showLikers && <LikersPopover clipId={clipId} onClose={close} within={wrapper} />}
      {error && (
        <span role="alert" className="like-error">
          {error}
        </span>
      )}
    </span>
  );
}
