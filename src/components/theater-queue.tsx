"use client";

import { useState } from "react";
import type { ClipSummary, QueueEntry, RoomQueueCommand } from "@/lib/realtime/envelope";
import { dropTarget } from "@/lib/theater/queue-drag";

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
  // The host reorders by dragging on desktop. Native drag and drop does not
  // fire on touch screens, so the arrows stay as the phone path.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);

  const target = dragFrom !== null && dropBefore !== null ? dropTarget(dragFrom, dropBefore) : null;

  function endDrag(): void {
    setDragFrom(null);
    setDropBefore(null);
  }

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
        <ol className="flex flex-col gap-2">
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
                draggable={iAmHost}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox will not start a drag without some data set.
                  event.dataTransfer.setData("text/plain", entry.entryId);
                  setDragFrom(index);
                }}
                onDragOver={(event) => {
                  if (dragFrom === null) {
                    return;
                  }

                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  setDropBefore(event.clientY < box.top + box.height / 2 ? index : index + 1);
                }}
                onDrop={(event) => {
                  event.preventDefault();

                  if (dragFrom !== null && target !== null) {
                    onQueue({
                      t: "room.queue",
                      op: "moveTo",
                      entryId: queue[dragFrom].entryId,
                      toIndex: target,
                    });
                  }

                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                {iAmHost && <span className="queue-grip" aria-hidden="true" />}
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
