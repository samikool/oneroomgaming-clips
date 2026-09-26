"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipSummary, QueueEntry, RoomQueueCommand } from "@/lib/realtime/envelope";
import { dropTarget, gapAtPointer } from "@/lib/theater/queue-drag";

type QueueOp = Exclude<RoomQueueCommand, { op: "add" }>;

/**
 * Up next. Everyone sees the same list; only the host gets the controls, and
 * `realtime` refuses them from anyone else regardless. Nothing here advances
 * on its own — the host presses Play next.
 */
export function TheaterQueue({
  queue,
  clipsById,
  iAmHost,
  onQueue,
}: {
  queue: QueueEntry[];
  clipsById: Map<string, ClipSummary>;
  iAmHost: boolean;
  onQueue(command: QueueOp): void;
}) {
  // The host reorders by dragging the grip. Pointer events rather than native
  // drag and drop, which never fires on touch screens, so one path serves
  // mouse, touch and pen. The arrows stay for keyboards and screen readers.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const target = dragFrom !== null && dropBefore !== null ? dropTarget(dragFrom, dropBefore) : null;

  function endDrag(): void {
    setDragFrom(null);
    setDropBefore(null);
  }

  function gapAt(clientY: number): number {
    const rows = listRef.current ? Array.from(listRef.current.children) : [];
    return gapAtPointer(clientY, rows.map((row) => row.getBoundingClientRect()));
  }

  // Escape drops the entry back where it was. The pointerup that follows
  // finds no drag in progress and does nothing.
  useEffect(() => {
    if (dragFrom === null) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setDragFrom(null);
        setDropBefore(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragFrom]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {iAmHost && (
        <div className="flex gap-2">
          <button
            type="button"
            className="button-primary flex-1"
            disabled={queue.length === 0}
            onClick={() => onQueue({ t: "room.queue", op: "playNext" })}
          >
            Play next
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={queue.length === 0}
            onClick={() => onQueue({ t: "room.queue", op: "clear" })}
          >
            Clear
          </button>
        </div>
      )}

      {queue.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing queued. Pick clips from the grid below to line them up.
        </p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-2">
          {queue.map((entry, index) => {
            const thumb = clipsById.get(entry.clipId)?.thumbPath;

            return (
              <li
                key={entry.entryId}
                className={[
                  "queue-entry",
                  iAmHost && "queue-entry-draggable",
                  dragFrom === index && "queue-entry-dragging",
                  target !== null && dropBefore === index && "queue-drop-above",
                  target !== null && dropBefore === queue.length && index === queue.length - 1 &&
                    "queue-drop-below",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {iAmHost && (
                  <span
                    className="queue-grip"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }

                      // Stops text selection and, with touch-action: none on
                      // the grip, keeps the page from scrolling instead.
                      event.preventDefault();
                      // Moves keep arriving here even once the pointer has
                      // left the grip, so the list can track it anywhere.
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDragFrom(index);
                      setDropBefore(gapAt(event.clientY));
                    }}
                    onPointerMove={(event) => {
                      if (dragFrom !== null) {
                        setDropBefore(gapAt(event.clientY));
                      }
                    }}
                    onPointerUp={(event) => {
                      // Where the pointer is now, not the last rendered
                      // target: a release can beat the render of the final move.
                      const to = dragFrom === null ? null : dropTarget(dragFrom, gapAt(event.clientY));

                      if (dragFrom !== null && to !== null) {
                        onQueue({
                          t: "room.queue",
                          op: "moveTo",
                          entryId: queue[dragFrom].entryId,
                          toIndex: to,
                        });
                      }

                      endDrag();
                    }}
                    onPointerCancel={endDrag}
                  />
                )}
                <span className="queue-index font-pixel">{index + 1}</span>
                <div className="queue-thumb">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{entry.title}</p>
                  <p className="truncate text-xs text-ink-muted">added by {entry.addedBy}</p>
                </div>
                {iAmHost && (
                  <div className="queue-actions">
                    {/* Column-major 2x2: reorder on the left, play and remove
                        on the right. */}
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Move ${entry.title} up`}
                      disabled={index === 0}
                      onClick={() =>
                        onQueue({ t: "room.queue", op: "move", entryId: entry.entryId, delta: -1 })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Move ${entry.title} down`}
                      disabled={index === queue.length - 1}
                      onClick={() =>
                        onQueue({ t: "room.queue", op: "move", entryId: entry.entryId, delta: 1 })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Play ${entry.title} now`}
                      onClick={() => onQueue({ t: "room.queue", op: "play", entryId: entry.entryId })}
                    >
                      {/* Drawn, not the ▶ character: many systems render that
                          as a coloured emoji next to the plain ↑ ↓ ✕ glyphs. */}
                      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                        <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="queue-action"
                      aria-label={`Remove ${entry.title} from the queue`}
                      onClick={() =>
                        onQueue({ t: "room.queue", op: "remove", entryId: entry.entryId })
                      }
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
