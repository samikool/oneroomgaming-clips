"use client";

import { useEffect, useRef, useState } from "react";
import { UserName } from "./user-name";

/** Who liked a clip, newest first. Closes on Escape or a click outside. */
export function LikersPopover({
  clipId,
  onClose,
  within,
}: {
  clipId: string;
  onClose(): void;
  /** Clicks inside this (the control that opened it) don't count as outside. */
  within?: React.RefObject<HTMLElement | null>;
}) {
  const [likers, setLikers] = useState<{ username: string; at: number }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clips/${clipId}/likers`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { likers: { username: string; at: number }[] }) => !cancelled && setLikers(data.likers))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onDown = (event: PointerEvent) => {
      const inside = (within?.current ?? ref.current)?.contains(event.target as Node);
      if (!inside) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, within]);

  return (
    <div ref={ref} className="likers-popover" role="dialog" aria-label="Who liked this">
      {failed ? (
        <p className="text-xs text-ink-muted">Couldn&apos;t load who liked this.</p>
      ) : likers === null ? (
        <p className="text-xs text-ink-muted">Loading…</p>
      ) : likers.length === 0 ? (
        <p className="text-xs text-ink-muted">No likes yet.</p>
      ) : (
        <ul className="likers-list">
          {likers.map((liker) => (
            <li key={liker.username}>
              <UserName username={liker.username} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
